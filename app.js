const { App } = require("@slack/bolt");
const { WebClient } = require("@slack/web-api");
const Airtable = require("airtable");
require("dotenv").config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
  port: process.env.PORT || 3000,
});

const userClient = new WebClient(process.env.SLACK_USER_TOKEN);

const ALLOWED_CHANNELS = ["G01DBHPLK25", "C07FL3G62LF", "C07UBURESHZ"];

const base = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(process.env.AIRTABLE_BASE_ID);

const INACTIVITY_CHECK_DELAY = 60 * 60 * 1000;
const activeThreads = new Map();

async function checkThreadActivity(threadTs, channelId, client) {
  setTimeout(async () => {
    try {
      const replies = await client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: 100,
      });

      const hasFormSubmission = replies.messages.some((msg) => msg.text && msg.text.includes("Conduct Report Filed :yay:"));

      if (!hasFormSubmission) {
        const lastMessageTs = replies.messages[replies.messages.length - 1].ts;
        const lastMessageTime = new Date(lastMessageTs * 1000);
        const now = new Date();

        if (now - lastMessageTime >= INACTIVITY_CHECK_DELAY) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: "Hey! Has this been resolved?",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: "Hey! Has this been resolved? If so, please submit a conduct report to help us keep track.",
                },
              },
              {
                type: "actions",
                elements: [
                  {
                    type: "button",
                    text: { type: "plain_text", text: "No, still ongoing", emoji: true },
                    action_id: "reset_thread_timer",
                    value: JSON.stringify({ threadTs, channelId }),
                    style: "danger",
                  },
                  {
                    type: "button",
                    text: { type: "plain_text", text: "Submit Report", emoji: true },
                    action_id: "open_conduct_modal",
                    style: "primary",
                  },
                ],
              },
            ],
          });
        }
      }

      activeThreads.delete(threadTs);
    } catch (error) {
      console.error("Error checking thread activity:", error);
    }
  }, INACTIVITY_CHECK_DELAY);
}

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

    if (!activeThreads.has(event.item.ts)) {
      activeThreads.set(event.item.ts, true);
      checkThreadActivity(event.item.ts, event.item.channel, client);
    }
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

    await base("Conduct Reports").create([
      {
        fields: {
          "Time Of Report": new Date().toISOString(),
          "Dealt With By": values.resolved_by.resolver_select.selected_users.join(", "),
          "User Being Dealt With": values.reported_user.user_select.selected_user,
          "What Did User Do": values.violation_deets.violation_deets_input.value,
          "How Was This Resolved": values.solution_deets.solution_input.value,
          "If Banned, Until When": values.ban_until.ban_date_input.selected_date || null,
          "Link To Message": permalink,
        },
      },
    ]);

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

app.command("/prevreports", async ({ command, ack, client, respond }) => {
  await ack();
  if (!ALLOWED_CHANNELS.includes(command.channel_id)) {
    respond({
      text: `You are not in the correct channel for this :P`,
      response_type: "ephemeral",
    });
    return;
  }
  try {
    const [userId, source] = command.text.trim().split(" ");
    if (!userId || !source) {
      return await client.chat.postMessage({
        channel: command.channel_id,
        text: "Use the format: `/prevreports @user slack|airtable`",
      });
    }

    const cleanUserId = userId.startsWith("<@") ? userId.slice(2, -1).split("|")[0] : userId.replace(/[<@>]/g, "");

    if (source.toLowerCase() === "slack") {
      const initialMessage = await client.chat.postMessage({
        channel: command.channel_id,
        text: `Searching messages... (this might take a while)`,
      });

      const msgSearch = await userClient.search.messages({
        query: `in:#hq-firehouse <@${cleanUserId}>`,
        count: 100,
        sort: "timestamp",
        sort_dir: "asc",
      });

      let allMessages = [...msgSearch.messages.matches];
      allMessages = allMessages.filter((match) => {
        const mentionsUser = match.text.includes(`<@${cleanUserId}>`);
        const isThreadMessage = match.thread_ts && match.thread_ts !== match.ts;
        return mentionsUser || !isThreadMessage;
      });

      allMessages.sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts));
      const filteredMessages = allMessages.filter((match) => ALLOWED_CHANNELS.includes(match.channel.id)).slice(0, 20);

      if (!filteredMessages.length) {
        return await client.chat.postMessage({
          channel: command.channel_id,
          text: `No previous messages mentioning ${userId} found in Slack :(`,
        });
      }
      const messageBlocks = await Promise.all(
        filteredMessages.map(async (match) => {
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
          return {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Message from: ${timestamp}*\n${shortenedText}\n<${permalinkResp.permalink}|View full message>`,
            },
          };
        })
      );

      const response = await client.chat.postMessage({
        channel: command.channel_id,
        text: `Most recent Slack messages mentioning ${userId}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Most recent Slack messages mentioning ${userId}:`,
            },
          },
          ...messageBlocks,
        ],
        unfurl_links: false,
        unfurl_media: false,
      });

      try {
        await client.chat.delete({
          channel: command.channel_id,
          ts: initialMessage.ts,
        });
      } catch (error) {
        console.error("Error deleting searching message:", error);
      }

      // Auto-delete after 1 hour
      setTimeout(async () => {
        try {
          await client.chat.delete({
            channel: command.channel_id,
            ts: response.ts,
          });
        } catch (error) {
          console.error("Error deleting results message:", error);
        }
      }, 2 * 60 * 1000);
    } else if (source.toLowerCase() === "airtable") {
      const records = await base("Conduct Reports")
        .select({
          filterByFormula: `{User Being Dealt With} = '${cleanUserId}'`,
          sort: [{ field: "Time Of Report", direction: "desc" }],
        })
        .all();

      console.log("Found records:", records.length);
      if (records.length > 0) {
        console.log("Record User Being Dealt With:", records[0].fields["User Being Dealt With"]);
      }

      if (!records.length) {
        return await client.chat.postMessage({
          channel: command.channel_id,
          text: `No previous reports found in the Airtable Base for ${userId} :(`,
        });
      }

      const formatUserMentions = async (userIds, client) => {
        if (!userIds) return "";
        const uids = userIds
          .replace(/[<@>]/g, "")
          .split(",")
          .map((id) => id.trim());
        const mentions = [];
        for (const uid of uids) {
          try {
            const result = await client.users.info({ user: uid });
            mentions.push(`@${result.user.name}`);
          } catch (error) {
            mentions.push(uid);
          }
        }

        return mentions.join(", ");
      };

      const reportEntries = await Promise.all(
        records.map(async (record) => {
          const fields = record.fields;
          const date = new Date(fields["Time Of Report"]).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });

          const dealtWithBy = await formatUserMentions(fields["Dealt With By"], client);

          let reportText = `*Report from ${date}*
  *Dealt With By:* ${dealtWithBy}
  *What Did User Do:* ${fields["What Did User Do"]}
  *How Was This Resolved:* ${fields["How Was This Resolved"]}
<${fields["Link To Message"]}|View Message>`;

          return reportText;
        })
      );

      const messageText = `Airtable records for ${userId}:\n\n${reportEntries.join("\n\n")}`;

      await client.chat.postMessage({
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
    } else {
      return await client.chat.postMessage({
        channel: command.channel_id,
        text: "Erm you need to specify 'slack' or 'airtable' ",
      });
    }
  } catch (error) {
    console.error("Error in /prevreports:", {
      error: error.message,
      stack: error.stack,
      command: command,
    });

    await client.chat.postMessage({
      channel: command.channel_id,
      text: `Error: ${error.message}. Please try again or contact support.`,
    });
  }
});

app.action("reset_thread_timer", async ({ ack, body, client }) => {
  await ack();
  try {
    const { threadTs, channelId } = JSON.parse(body.actions[0].value);

    if (!activeThreads.has(threadTs)) {
      activeThreads.set(threadTs, true);
      checkThreadActivity(threadTs, channelId, client);
    }

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: "Timer reset - we'll check back in a few minutes!",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Timer reset - we'll check back in a few minutes!",
          },
        },
      ],
    });
  } catch (error) {
    console.error("Error resetting thread timer:", error);
  }
});

(async () => {
  await app.start();
  console.log("⚡️ Bolt app is running!");
})();
