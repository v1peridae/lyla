const { App } = require("@slack/bolt");
const { WebClient } = require("@slack/web-api");
const Airtable = require("airtable");
require("dotenv").config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
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
                  text: "Hey! Has this been resolved?",
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
      console.error(error);
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

    const checkInactivity = async () => {
      try {
        const replies = await client.conversations.replies({
          channel: event.item.channel,
          ts: event.item.ts,
          limit: 100,
        });

        const hasFormSubmission = replies.messages.some((msg) => msg.text && msg.text.includes("Conduct Report Filed :yay:"));

        if (!hasFormSubmission) {
          const lastMessageTs = replies.messages[replies.messages.length - 1].ts;
          const lastMessageTime = new Date(lastMessageTs * 1000);
          const now = new Date();

          if (now - lastMessageTime >= INACTIVITY_CHECK_DELAY) {
            await client.chat.postMessage({
              channel: event.item.channel,
              thread_ts: event.item.ts,
              text: "Has this been resolved?",
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: "Has this been resolved?",
                  },
                },
                {
                  type: "actions",
                  elements: [
                    {
                      type: "button",
                      text: { type: "plain_text", text: "No, still being sorted :)", emoji: true },
                      action_id: "reset_thread_timer",
                      value: JSON.stringify({ threadTs: event.item.ts, channelId: event.item.channel }),
                      style: "danger",
                    },
                    {
                      type: "button",
                      text: { type: "plain_text", text: "Add A Record", emoji: true },
                      action_id: "open_conduct_modal",
                      style: "primary",
                    },
                  ],
                },
              ],
            });
            return;
          }
          setTimeout(checkInactivity, INACTIVITY_CHECK_DELAY);
        }
      } catch (error) {
        console.error(error);
      }
    };

    setTimeout(checkInactivity, INACTIVITY_CHECK_DELAY);
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
    const reportedUserId = values.reported_user.user_select.selected_user;

    const userProfile = await client.users.profile.get({
      user: reportedUserId,
    });

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
          "User Being Dealt With": reportedUserId,
          "Display Name": userProfile.profile.display_name || userProfile.profile.real_name,
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
      return await respond({
        text: "Use the format: `/prevreports @user slack|airtable`",
        response_type: "ephemeral",
      });
    }

    const cleanUserId = userId.startsWith("<@") ? userId.slice(2, -1).split("|")[0] : userId.replace(/[<@>]/g, "");

    if (source.toLowerCase() === "slack") {
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
        return await respond({
          text: `No previous messages mentioning ${userId} found in Slack :(`,
          response_type: "ephemeral",
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

      await respond({
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
        response_type: "ephemeral",
        unfurl_links: false,
        unfurl_media: false,
      });
    } else if (source.toLowerCase() === "airtable") {
      const records = await base("Conduct Reports")
        .select({
          filterByFormula: `{User Being Dealt With} = '${cleanUserId}'`,
          sort: [{ field: "Time Of Report", direction: "desc" }],
        })
        .all();

      if (!records.length) {
        return await respond({
          text: `No previous reports found in the Airtable Base for ${userId} :(`,
          response_type: "ephemeral",
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

      await respond({
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
        response_type: "ephemeral",
        unfurl_links: false,
        unfurl_media: false,
      });
    } else {
      return await respond({
        text: "Erm you need to specify 'slack' or 'airtable'",
        response_type: "ephemeral",
      });
    }
  } catch (error) {
    console.error(error);
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
      text: "LYLA WILL BE BACK MUHEHEHHEHE",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "I'll be back soon :P",
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
