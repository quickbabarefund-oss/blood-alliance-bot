// Builds an .xlsx workbook in-memory using exceljs.
// Returns a Uint8Array suitable for multipart/form-data upload to Discord.
import ExcelJS from "npm:exceljs@4.4.0";

export type LbRow = {
  rank: number;
  clan_name?: string;
  player_name: string;
  player_tag: string;
  donations: number;
  donations_received: number;
};

export async function buildLeaderboardXlsx(opts: {
  title: string;
  monthLabel: string;
  rows: LbRow[];
  includeClan: boolean;
}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CoC Donation Tracker";
  wb.created = new Date();
  const ws = wb.addWorksheet(opts.monthLabel.slice(0, 30));

  ws.mergeCells("A1:G1");
  const titleCell = ws.getCell("A1");
  titleCell.value = `${opts.title} — Final standings (${opts.monthLabel})`;
  titleCell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 24;

  const cols = opts.includeClan
    ? ["Rank", "Clan", "Player", "Tag", "Donated", "Received", "Ratio"]
    : ["Rank", "Player", "Tag", "Donated", "Received", "Ratio"];

  ws.getRow(3).values = cols;
  ws.getRow(3).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } };
  ws.getRow(3).alignment = { horizontal: "center" };

  const widths = opts.includeClan ? [8, 22, 22, 14, 12, 12, 10] : [8, 22, 14, 12, 12, 10];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  let row = 4;
  for (const r of opts.rows) {
    const ratio = r.donations_received > 0 ? (r.donations / r.donations_received).toFixed(2) : "∞";
    const values = opts.includeClan
      ? [r.rank, r.clan_name ?? "", r.player_name, r.player_tag, r.donations, r.donations_received, ratio]
      : [r.rank, r.player_name, r.player_tag, r.donations, r.donations_received, ratio];
    ws.getRow(row).values = values;
    if (row % 2 === 0) {
      ws.getRow(row).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    }
    row++;
  }

  // Number formatting on Donated/Received
  const donCol = opts.includeClan ? 5 : 4;
  ws.getColumn(donCol).numFmt = "#,##0";
  ws.getColumn(donCol + 1).numFmt = "#,##0";

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
