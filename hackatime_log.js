// new file omg
function buildTrustLevelSlackBlocks(log) {
  return {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🚨 New hackatime ban",
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*User:*\n<@${log.user_slack_uid[1]}>`,
          },
          {
            type: "mrkdwn",
            text: `*Changed By:*\n<@${log.changed_by_slack_uid[1]}>`,
          },
          {
            type: "mrkdwn",
            text: `*Previous trust level:*\n\`${log.previous_trust_level[1]}\``,
          },
          {
            type: "mrkdwn",
            text: `*Reason:*\n_${log.reason[1]}_`,
          },
          {
            type: "mrkdwn",
            text: `*Notes:*\n${log.notes[1]}`,
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `🕒 Created: ${log.created_at[1]} | Updated: ${log.updated_at[1]}`,
          },
          {
            type: "mrkdwn",
            text: `Audit Log ID: <https://hackatime.hackclub.com/admin/trust_level_audit_logs/${log.id[1]}|${log.id[1]}> - <https://billy.3kh0.net/?u=${log.user_id[1]}|Billy>`,
          },
        ],
      },
    ],
  };
}
module.exports = (app, db) => {
  fetch("https://hackatime.hackclub.com/api/admin/v1/execute", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.HACKATIME_ADMIN_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query:
        "SELECT tla.*, u1.slack_uid  AS user_slack_uid, u2.slack_uid  AS changed_by_slack_uid FROM trust_level_audit_logs AS tla JOIN users AS u1 ON u1.id = tla.user_id JOIN users AS u2 ON u2.id = tla.changed_by_id WHERE tla.new_trust_level = 'red'  ORDER BY tla.id DESC;",
    }),
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`status: ${response.status}`);
      }
      return response.json();
    })
    .then(async (data) => {
      if (!data || !data.rows || !Array.isArray(data.rows)) {
        console.log("hackatime data messed up:", data);
        return;
      }
      for (const row of data.rows.reverse()) {
        if (await db.get("hackatime_log_" + row.id[1])) {
          continue; // Skip if already logged
        }
        const blocks = buildTrustLevelSlackBlocks(row);
        app.client.chat.postMessage({
          channel: "C099RL60G7R",
          blocks: blocks.blocks,
          text: `🚨 New hackatime ban for <@${row.user_slack_uid[1]}>`,
        });
        await db.set("hackatime_log_" + row.id[1], true);
        await new Promise((r) => setTimeout(r, 1500)); // Rate limit
      }
    })
    .catch((error) => {
      console.error("error fetching hackatime data:", error);
    });
};
