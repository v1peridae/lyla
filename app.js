const { App } = require("@slack/bolt");
const Airtable = require("airtable");
require("dotenv").config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
  port: process.env.PORT || 3000,
});

const base = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(process.env.AIRTABLE_BASE_ID);
const ALLOWED_CHANNELS = ["C07FL3G62LF"];

app.event("reaction_added", async ({ event, client }) => {
  console.log("Reaction event received:", {
    channel: event.item.channel,
    reaction: event.reaction,
  });

  if (event.reaction !== "ban") return;

  try {
    await client.chat.postMessage({
      channel: event.item.channel,
      thread_ts: event.item.ts,
      text: "Wanna file a conduct report?",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "*Wanna file a conduct report?*" },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "File A Report Here", emoji: true },
              action_id: "open_conduct_modal",
              style: "primary",
            },
          ],
        },
      ],
    });
  } catch (error) {
    console.error("Error posting message:", error);
  }
});

const modalBlocks = [
  {
    type: "input",
    block_id: "reported_user",
    label: { type: "plain_text", text: "User Being Reported?" },
    element: { type: "users_select", action_id: "user_select" },
  },
  {
    type: "input",
    block_id: "violation_deets",
    label: { type: "plain_text", text: "What Did They Do?" },
    element: {
      type: "plain_text_input",
      action_id: "violation_deets_input",
      multiline: true,
    },
  },
  {
    type: "input",
    block_id: "solution_deets",
    label: { type: "plain_text", text: "How Was This Solved?" },
    element: {
      type: "plain_text_input",
      action_id: "solution_input",
      multiline: true,
    },
  },
  {
    type: "input",
    block_id: "ban_until",
    label: { type: "plain_text", text: "If Banned, Until When?" },
    element: {
      type: "datepicker",
      action_id: "ban_date_input",
      placeholder: { type: "plain_text", text: "Select a date" },
    },
    optional: true,
  },
  {
    type: "input",
    block_id: "resolved_by",
    label: { type: "plain_text", text: "Who Resolved This? (Thank you btw <3)" },
    element: { type: "users_select", action_id: "resolver_select" },
  },
];

app.action("open_conduct_modal", async ({ ack, body, client }) => {
  await ack();
  try {
    const permalinkResponse = await client.chat.getPermalink({
      channel: body.channel.id,
      message_ts: body.message.thread_ts || body.message.ts,
    });

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "conduct_report",
        private_metadata: JSON.stringify({
          channel: body.channel.id,
          thread_ts: body.message.thread_ts || body.message.ts,
          permalink: permalinkResponse.permalink,
        }),
        title: { type: "plain_text", text: "FD Record Keeping" },
        blocks: modalBlocks,
        submit: { type: "plain_text", text: "Submit" },
      },
    });
  } catch (error) {
    console.error(error);
  }
});

app.view("conduct_report", async ({ ack, view, client, body }) => {
  await ack();
  try {
    const values = view.state.values;
    const { channel, thread_ts, permalink } = JSON.parse(view.private_metadata);

    const airtableData = {
      "Time Of Report": new Date().toISOString(),
      "Dealt With By": body.user.id,
      "User Being Dealt With": values.reported_user.user_select.selected_user,
      "What Did User Do": values.violation_deets.violation_deets_input.value,
      "How Was This Resolved": values.solution_deets.solution_input.value,
      "If Banned, Until When": values.ban_until.ban_date_input.selected_date || null,
      "Link To Message": permalink,
    };

    await base("Conduct Reports").create(airtableData);

    const reportFields = [
      `*Reported User:*\n<@${values.reported_user.user_select.selected_user}>`,
      `*Resolved By:*\n<@${values.resolved_by.resolver_select.selected_user}>`,
      `*What Did They Do?*\n${values.violation_deets.violation_deets_input.value}`,
      `*How Did We Deal With This?*\n${values.solution_deets.solution_input.value}`,
      `*If Banned, Ban Until:*\n${values.ban_until.ban_date_input.selected_date || "N/A"}`,
      `*Link To Message:*\n${permalink}`,
    ];

    await client.chat.postMessage({
      channel,
      thread_ts,
      text: "Added to the Airtable",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "*Your Conduct Report Has Been Added To The Airtable, thank youu!*" },
        },
        {
          type: "section",
          fields: reportFields.map((text) => ({ type: "mrkdwn", text })),
        },
      ],
    });
  } catch (error) {
    console.error(error);
  }
});

app.command("/prevreports", async ({ command, ack, client }) => {
  await ack();
  if (!ALLOWED_CHANNELS.includes(command.channel_id)) {
    return respond("Nuh uh, you shouldn't be able to use that >:)");
  }

  try {
    const userId = command.text.trim();
    const records = await base("Conduct Reports")
      .select({
        filterByFormula: `{User Being Dealt With} = '${userId}'`,
      })
      .all();

    if (!records.length) {
      return client.chat.postMessage({
        channel: command.channel_id,
        text: `No previous conduct reports found for <@${userId}>.`,
      });
    }

    const reportsText = records
      .map(
        ({ fields }) =>
          `*Report from: ${fields["Time Of Report"]}*\n` +
          `Dealt with by: <@${fields["Dealt With By"]}>\n` +
          `What they did: ${fields["What Did User Do"]}\n` +
          `How we dealt with this: ${fields["How Was This Resolved"]}`
      )
      .join("\n\n");

    await client.chat.postMessage({
      channel: command.channel_id,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Previous reports for <@${userId}>:\n\n${reportsText}`,
          },
        },
      ],
    });
  } catch (error) {
    console.error(error);
  }
});

(async () => {
  await app.start();
  console.log("⚡️ Bolt app is running!");
})();
