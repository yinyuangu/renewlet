import type { EmailTemplateData, EmailTemplateItem } from "./email-template";

export function renderEmailTemplate(data: EmailTemplateData): string {
  const groupsOrContent = data.groups.length > 0 ? renderGroups(data) : renderContentPanel(data);
  const cta = data.cta ? renderCta(data) : "";
  return `<!doctype html>
<html lang="${escapeAttr(data.lang)}">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(data.title)}</title>
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    body, table, td, p, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    @media screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .email-px { padding-left: 18px !important; padding-right: 18px !important; }
      .email-stack { display: block !important; width: 100% !important; text-align: left !important; }
      .email-stack-pad { padding-top: 6px !important; }
      .email-hide-mobile { display: none !important; }
    }
    @media (prefers-color-scheme: dark) {
      .email-bg { background-color: #111827 !important; }
      .email-card { background-color: #182230 !important; border-color: #334155 !important; }
      .email-text { color: #F8FAFC !important; }
      .email-muted { color: #CBD5E1 !important; }
      .email-panel { background-color: #1F2937 !important; border-color: #334155 !important; }
      .email-rule { border-color: #334155 !important; }
    }
  </style>
</head>
<body class="email-bg" style="margin:0; padding:0; background-color:${data.theme.background}; color:${data.theme.text}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none; font-size:1px; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden; mso-hide:all;">${escapeHtml(data.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <center class="email-bg" style="width:100%; background-color:${data.theme.background};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse; background-color:${data.theme.background};">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" class="email-container email-card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; border-collapse:separate; border-spacing:0; background-color:${data.theme.surface}; border:1px solid ${data.theme.border}; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(15,23,42,0.08);">
            <tr>
              <td height="4" style="height:4px; font-size:0; line-height:0; background-color:${data.theme.primary};">&nbsp;</td>
            </tr>
            <tr>
              <td class="email-px email-rule" style="padding:18px 28px 16px 28px; border-bottom:1px solid ${data.theme.border};">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse;">
                  <tr>
                    <td align="left" valign="middle" style="vertical-align:middle;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                        <tr>
                          <td width="28" height="28" align="center" valign="middle" style="width:28px; height:28px; border-radius:7px; background-color:${data.theme.primarySoft}; color:${data.theme.primary}; font-size:14px; font-weight:800; line-height:28px;">R</td>
                          <td valign="middle" class="email-text" style="padding-left:10px; color:${data.theme.text}; font-size:16px; font-weight:800; line-height:22px;">Renewlet</td>
                        </tr>
                      </table>
                    </td>
                    <td align="right" valign="middle" class="email-muted" style="vertical-align:middle; color:${data.theme.muted}; font-size:12px; font-weight:600; line-height:18px;">${escapeHtml(data.copy.brandTagline)}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="email-px" style="padding:22px 28px 8px 28px;">
                <p style="margin:0 0 7px 0; color:${data.theme.primary}; font-size:13px; font-weight:700; line-height:18px;">${escapeHtml(data.statusLabel)}</p>
                <h1 class="email-text" style="margin:0; color:${data.theme.text}; font-size:22px; font-weight:800; line-height:29px;">${escapeHtml(data.title)}</h1>
                ${renderSummaryRows(data)}
              </td>
            </tr>
            ${groupsOrContent}
            ${cta}
            <tr>
              <td class="email-px" style="padding:20px 28px 26px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-rule" style="width:100%; border-collapse:collapse; border-top:1px solid ${data.theme.border};">
                  <tr>
                    <td class="email-muted" style="padding-top:13px; color:${data.theme.muted}; font-size:12px; line-height:19px;">
                      <p style="margin:0;"><strong class="email-text" style="color:${data.theme.text}; font-weight:700;">${escapeHtml(data.copy.generatedAt)}</strong> ${escapeHtml(data.timestamp)}</p>
                      <p style="margin:6px 0 0 0;">${escapeHtml(data.copy.footer)}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </center>
</body>
</html>`;
}

function renderSummaryRows(data: EmailTemplateData): string {
  if (data.summaryRows.length === 0) return "";
  const rows = data.summaryRows
    .map((row, index) => `${index === 0 ? "" : " &middot; "}${escapeHtml(row.label)}: <strong class="email-text" style="color:${data.theme.text}; font-weight:700;">${escapeHtml(row.value)}</strong>`)
    .join("");
  return `<p class="email-muted" style="margin:11px 0 0 0; color:${data.theme.muted}; font-size:13px; line-height:20px;">${rows}</p>`;
}

function renderGroups(data: EmailTemplateData): string {
  return data.groups.map((group) => `
            <tr>
              <td class="email-px" style="padding:14px 28px 0 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-rule" style="width:100%; border-collapse:collapse; border-top:1px solid ${data.theme.border};">
                  <tr>
                    <td style="padding:13px 0 7px 0;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse;">
                        <tr>
                          <td align="left" class="email-text" style="color:${data.theme.text}; font-size:14px; font-weight:800; line-height:21px;">${escapeHtml(group.label)}</td>
                          <td align="right" class="email-muted" style="color:${data.theme.muted}; font-size:12px; font-weight:700; line-height:18px;">${group.count}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  ${group.items.map((item) => renderGroupItem(data, item)).join("")}
                </table>
              </td>
            </tr>`).join("");
}

function renderGroupItem(data: EmailTemplateData, item: EmailTemplateItem): string {
  return `
                  <tr>
                    <td class="email-rule" style="padding:11px 0; border-top:1px solid ${data.theme.border};">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse;">
                        <tr>
                          <td width="45%" valign="top" style="width:45%; vertical-align:top; padding-right:14px;">
                            <p class="email-text" style="margin:0; color:${data.theme.text}; font-size:15px; font-weight:800; line-height:21px;">${escapeHtml(item.name)}</p>
                            <p class="email-muted" style="margin:4px 0 0 0; color:${data.theme.muted}; font-size:12px; line-height:18px;">${escapeHtml(item.dateLabel)} &middot; ${escapeHtml(item.targetDate)}</p>
                          </td>
                          <td width="30%" valign="top" class="email-stack email-stack-pad" style="width:30%; vertical-align:top; padding-right:12px;">
                            <p style="margin:0; color:${item.accentText}; font-size:13px; font-weight:700; line-height:19px;">${escapeHtml(item.detail)}</p>
                          </td>
                          <td width="25%" align="right" valign="top" class="email-stack email-stack-pad" style="width:25%; vertical-align:top; text-align:right; white-space:nowrap;">
                            <p class="email-text" style="margin:0; color:${data.theme.text}; font-size:15px; font-weight:800; line-height:21px;">${escapeHtml(item.amount)} ${escapeHtml(item.currency)}</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>`;
}

function renderContentPanel(data: EmailTemplateData): string {
  const content = data.contentLines.map(escapeHtml).join("<br>");
  return `
            <tr>
              <td class="email-px" style="padding:16px 28px 0 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-panel" style="width:100%; border-collapse:separate; border-spacing:0; background-color:${data.theme.surfaceMuted}; border:1px solid ${data.theme.border}; border-radius:8px;">
                  <tr>
                    <td style="padding:16px 18px;">
                      <p class="email-muted" style="margin:0 0 7px 0; color:${data.theme.muted}; font-size:12px; font-weight:700; line-height:18px;">${escapeHtml(data.copy.message)}</p>
                      <p class="email-text" style="margin:0; color:${data.theme.text}; font-size:15px; line-height:24px;">${content}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

function renderCta(data: EmailTemplateData): string {
  const cta = data.cta;
  if (!cta) return "";
  return `
            <tr>
              <td class="email-px" style="padding:20px 28px 0 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" style="border-collapse:separate; border-spacing:0;">
                  <tr>
                    <td align="center" valign="middle" bgcolor="${data.theme.primary}" style="background-color:${data.theme.primary}; border-radius:8px;">
                      <a href="${escapeAttr(cta.url)}" style="display:inline-block; padding:0 18px; color:${data.theme.primaryText}; font-size:14px; font-weight:800; line-height:44px; text-decoration:none;">${escapeHtml(cta.label)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

function escapeHtml(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
