const { App } = require("@slack/bolt");
const { WebClient } = require("@slack/web-api");
require("dotenv").config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
  port: process.env.PORT || 3000,
});

const userClient = new WebClient(process.env.SLACK_USER_TOKEN);

const ALLOWED_CHANNELS = ["G01DBHPLK25", "C07FL3G62LF", "C07UBURESHZ"];

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
    console.error(error);
  }
});

const modalBlocks = [
  {
    type: "input",
    block_id: "reported_user",
    label: { type: "plain_text", text: "User Being Reported?" },
    element: {
      type: "users_select",
      action_id: "user_select",
      include_restricted_users: true,
    },
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
    label: { type: "plain_text", text: "If Banned or Shushed, Until When?" },
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
    element: {
      type: "multi_users_select",
      action_id: "resolver_select",
    },
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

    const resolvedBy = values.resolved_by.resolver_select.selected_users.map((user) => `<@${user}>`).join(", ");

    const banDate = values.ban_until.ban_date_input.selected_date
      ? new Date(values.ban_until.ban_date_input.selected_date).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "N/A";

    const reportFields = [
      `*Reported User:*\n<@${values.reported_user.user_select.selected_user}>`,
      `*Resolved By:*\n${resolvedBy}`,
      `*What Did They Do?*\n${values.violation_deets.violation_deets_input.value}`,
      `*How Did We Deal With This?*\n${values.solution_deets.solution_input.value}`,
      `*If Banned or Shushed, Until:*\n${banDate || "N/A"}`,
      `*Link To Message:*\n${permalink}`,
    ];

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
    const usersResponse = await client.users.list();
    const users = usersResponse.members;
    const user = users.find((u) => u.profile.display_name === userId || u.name === userId);
    if (user) {
      userId = user.id;
    }

    const msgSearch = await userClient.search.messages({
      query: `<@${userId}>`,
      count: 100,
      sort: "timestamp",
      sort_dir: "desc",
    });

    if (!msgSearch.messages.matches.length) {
      return await client.chat.postMessage({
        channel: command.channel_id,
        text: `No previous messages mentioning ${userId} found :(`,
      });
    }

    const msgsWithLinks = await Promise.all(
      msgSearch.messages.matches
        .filter((match) => ALLOWED_CHANNELS.includes(match.channel.id))
        .map(async (match) => {
          const permalinkResp = await client.chat.getPermalink({
            channel: match.channel.id,
            message_ts: match.ts,
          });

          const messageDate = new Date(parseFloat(match.ts) * 1000);
          const formattedDate = messageDate.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
          const formattedTime = messageDate.toLocaleString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          });
          const timestamp = `${formattedDate} at ${formattedTime}`;

          const shortenedText = match.text.length > 200 ? match.text.substring(0, 200) + "..." : match.text;

          return `*Message from: ${timestamp}*\n${shortenedText}\n<${permalinkResp.permalink}|View full message>`;
        })
    );

    const messageText = `Messages mentioning ${userId}:\n\n${msgsWithLinks.join("\n\n")}`;

    const response = await client.chat.postMessage({
      channel: command.channel_id,
      text: messageText,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: messageText.substring(0, 2900),
          },
        },
      ],
      unfurl_links: false,
      unfurl_media: false,
    });

    setTimeout(async () => {
      try {
        await client.chat.delete({
          channel: command.channel_id,
          ts: response.ts,
        });
      } catch (error) {
        console.error(error);
      }
    }, 3600000);
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
