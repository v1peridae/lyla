const { App } = require("@slack/bolt");
const { WebClient } = require("@slack/web-api");
const Airtable = require("airtable");
const schedule = require("node-schedule");
require("dotenv").config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  port: process.env.PORT || 3000,
});

const userClient = new WebClient(process.env.SLACK_USER_TOKEN);
const ALLOWED_CHANNELS = ["G01DBHPLK25", "C07FL3G62LF", "C07UBURESHZ"];
const base = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(process.env.AIRTABLE_BASE_ID);

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
    block_id: "reported_users",
    label: { type: "plain_text", text: "User(s) Being Reported?" },
    element: {
      type: "multi_users_select",
      action_id: "users_select",
    },
    optional: true,
  },
  {
    type: "input",
    block_id: "banned_user_ids",
    label: { type: "plain_text", text: "User ID - Separate multiple with commas" },
    element: {
      type: "plain_text_input",
      action_id: "banned_ids_input",
    },
    optional: true,
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
      type: "static_select",
      action_id: "solution_select",
      placeholder: { type: "plain_text", text: "Howd'ya deal with it?" },
      options: [
        { text: { type: "plain_text", text: "Temp Ban" }, value: "Temp Ban" },
        { text: { type: "plain_text", text: "Perma Ban" }, value: "Perma Ban" },
        { text: { type: "plain_text", text: "DM" }, value: "DM" },
        { text: { type: "plain_text", text: "Warning" }, value: "Warning" },
        { text: { type: "plain_text", text: "Shush" }, value: "Shush" },
        { text: { type: "plain_text", text: "Locked Thread" }, value: "Locked Thread" },
      ],
    },
    optional: true,
  },

  {
    type: "input",
    block_id: "custom_solution",
    label: { type: "plain_text", text: "Howd'ya deal with it? (Text edition)" },
    element: {
      type: "plain_text_input",
      action_id: "solution_custom_input",
      multiline: true,
    },
    optional: true,
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

    const selectedUsers = values.reported_users.users_select.selected_users || [];
    const bannedUserIds = values.banned_user_ids.banned_ids_input.value
      ? values.banned_user_ids.banned_ids_input.value.split(",").map((id) => id.trim())
      : [];

    const allUserIds = [...selectedUsers, ...bannedUserIds];
    const banDate = values.ban_until.ban_date_input.selected_date;

    const dropdwnsolution = values.solution_deets.solution_select.selected_option.value;
    const customsolution = values.solution_custom.solution_custom_input.value;
    const finalsolution = customsolution || dropdwnsolution;

    if (allUserIds.length === 0) {
      throw new Error("Select users or enter their user IDs");
    }

    for (const userId of allUserIds) {
      let displayName = "Unknown (Banned User)";

      try {
        const userProfile = await client.users.profile.get({ user: userId });
        displayName = userProfile.profile.display_name || userProfile.profile.real_name;
      } catch (error) {
        console.log(`Couldn't fetch profile for ${userId}`);
      }

      await base("LYLA Records").create([
        {
          fields: {
            "Time Of Report": new Date().toISOString(),
            "Dealt With By": values.resolved_by.resolver_select.selected_users.join(", "),
            "User Being Dealt With": userId,
            "Display Name": displayName,
            "What Did User Do": values.violation_deets.violation_deets_input.value,
            "How Was This Resolved": finalsolution,
            "If Banned, Until When": values.ban_until.ban_date_input.selected_date || null,
            "Link To Message": permalink,
          },
        },
      ]);
    }

    const reportFields = [
      `*Reported Users:*\n${allUserIds.map((id) => `<@${id.replace(/[<@>]/g, "")}>`).join(", ")}`,
      `*Resolved By:*\n${values.resolved_by.resolver_select.selected_users.map((user) => `<@${user}>`).join(", ")}`,
      `*What Did They Do?*\n${values.violation_deets.violation_deets_input.value}`,
      `*How Did We Deal With This?*\n${finalsolution}`,
      `*If Banned or Shushed, Until:*\n${
        values.ban_until.ban_date_input.selected_date
          ? new Date(values.ban_until.ban_date_input.selected_date).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : "N/A"
      }`,
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
    if (banDate) {
      const dateFormat = new Date(banDate).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

      const action = finalsolution.toLowerCase().includes("ban")
        ? "banned"
        : finalsolution.toLowerCase().includes("shush")
        ? "shushed"
        : "banned/shushed";

      const userMention = allUserIds.map((id) => `<@${id.replace(/[<@>]/g, "")}>`).join(", ");

      await client.chat.postMessage({
        channel: "C07UBURESHZ",
        text: `${userMention} has been ${action} until ${dateFormat}... be good kids ^^`,
      });
    }
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
          text: `No previous messages mentioning ${userId} found in Slack :)`,
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
      const records = await base("LYLA Records")
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

async function checkBansForToday(client) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const records = await base("LYLA Records")
      .select({
        filterByFormula: `AND(
          NOT({If Banned, Until When} = BLANK()),
          IS_SAME({If Banned, Until When}, TODAY(), 'day')
        )`,
      })
      .all();

    if (records.length > 0) {
      const banMessages = records.map((record) => {
        const userId = record.fields["User Being Dealt With"];
        const banEndDate = new Date(record.fields["If Banned, Until When"]).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
        return `<@${userId}>'s ban/shush ends today (${banEndDate}), react ✅ if unbanned :)`;
      });

      await client.chat.postMessage({
        channel: "G01DBHPLK25",
        text: "Unban awaiting!!",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: banMessages.join("\n\n"),
            },
          },
        ],
      });
    }
  } catch (error) {
    console.error("Error checking bans:", error);
  }
}
(async () => {
  await app.start();
  console.log("⚡️ Bolt app is running!");

  schedule.scheduleJob(
    {
      hour: 7,
      minute: 0,
      tz: "America/New_York",
    },
    async () => {
      await checkBansForToday(app.client);
    }
  );
})();
