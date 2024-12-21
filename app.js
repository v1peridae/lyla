const { App } = require("@slack/bolt");
require("dotenv").config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
  port: process.env.PORT || 3000,
});

const ALLOWED_CHANNELS = ["G01DBHPLK25", "C07FL3G62LF"];

app.event("reaction_added", async ({ event, client }) => {
  if (!ALLOWED_CHANNELS.includes(event.item.channel) || event.reaction !== "ban") return;

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

app.view("conduct_report", async ({ ack, view, client }) => {
  await ack();
  try {
    const values = view.state.values;
    const { channel, thread_ts, permalink } = JSON.parse(view.private_metadata);
    const banDate = values.ban_until.ban_date_input.selected_date;

    const reportFields = [
      `*Reported User:*\n<@${values.reported_user.user_select.selected_user}>`,
      `*Resolved By:*\n<@${values.resolved_by.resolver_select.selected_user}>`,
      `*What Did They Do?*\n${values.violation_deets.violation_deets_input.value}`,
      `*How Did We Deal With This?*\n${values.solution_deets.solution_input.value}`,
      `*If Banned, Ban Until:*\n${values.ban_until.ban_date_input.selected_date || "N/A"}`,
      `*Link To Message:*\n${permalink}`,
    ];

    await base("Conduct Reports").create(airtableData);

    await client.chat.postMessage({
      channel,
      thread_ts,
      text: "Conduct Report Filed :yay:",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "*Thanks for filling this <3*" },
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
  try {
    let userId = command.text.trim();
    const mentionMatch = userId.match(/^<@([A-Z0-9]+)>$/);
    if (mentionMatch) {
      userId = mentionMatch[1];
    }

    const result = await client.conversations.history({
      channel: ALLOWED_CHANNELS[0],
      limit: 10,
    });

    const relevantMsgs = result.messages.filter((message) => {
      const hasMention = message.text.includes(`<@${userId}>`);
      return hasMention;
    });

    if (!relevantMsgs.length) {
      return await client.chat.postMessage({
        channel: command.channel_id,
        text: `No previous messages mentioning <@${userId}> found :(`,
      });
    }

    const msgsWithLinks = await Promise.all(
      relevantMsgs.map(async (msg) => {
        const permalinkResp = await client.chat.getPermalink({
          channel: ALLOWED_CHANNELS[0],
          message_ts: msg.ts,
        });
        const timestamp = new Date(msg.ts * 1000).toLocaleString();
        return `*Message from: ${timestamp}*\n${msg.text}\n<${permalinkResp.permalink}|View message>`;
      })
    );

    await client.chat.postMessage({
      channel: command.channel_id,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Messages mentioning <@${userId}>:\n\n${msgsWithLinks.join("\n\n")}`,
          },
        },
      ],
      unfurl_links: false,
      unfurl_media: false,
    });
  } catch (error) {
    console.error(error);
    await client.chat.postMessage({
      channel: command.channel_id,
      text: "Oopsie, eh I'll get to that!",
    });
  }
});

(async () => {
  await app.start();
  console.log("⚡️ Bolt app is running!");
})();
