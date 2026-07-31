import {
  AlignmentType,
  BorderStyle,
  Document,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx'

export const LANDSCAPE_REPORT_WIDTH = 14_160

const tableBorders = {
  top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 3, color: 'E2E8F0' },
  insideVertical: { style: BorderStyle.SINGLE, size: 3, color: 'E2E8F0' },
}

export function reportTitle(title: string, subtitle: string) {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: title, bold: true, size: 32, color: '0F172A', font: 'Arial' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: subtitle, size: 18, color: '64748B', font: 'Arial' })],
    }),
  ]
}

function reportCell(text: string, width: number, header = false, centered = false) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 110, bottom: 110, left: 120, right: 120 },
    shading: header ? { type: ShadingType.CLEAR, fill: 'E8EEF8', color: 'auto' } : undefined,
    children: [new Paragraph({
      alignment: centered ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { before: 0, after: 0, line: 240 },
      children: [new TextRun({
        text,
        bold: header,
        size: header ? 18 : 17,
        color: header ? '1E3A5F' : '0F172A',
        font: 'Arial',
      })],
    })],
  })
}

export function reportTable(
  headers: string[],
  rows: string[][],
  widths: number[],
  centeredColumns: number[] = []
) {
  if (headers.length !== widths.length || rows.some((row) => row.length !== headers.length)) {
    throw new Error('Word report table geometry does not match its data.')
  }
  if (widths.reduce((sum, width) => sum + width, 0) !== LANDSCAPE_REPORT_WIDTH) {
    throw new Error('Word report table widths must total the landscape report width.')
  }
  return new Table({
    width: { size: LANDSCAPE_REPORT_WIDTH, type: WidthType.DXA },
    indent: { size: 120, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: tableBorders,
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: headers.map((header, index) =>
          reportCell(header, widths[index], true, centeredColumns.includes(index))
        ),
      }),
      ...rows.map((row) => new TableRow({
        cantSplit: false,
        children: row.map((value, index) =>
          reportCell(value, widths[index], false, centeredColumns.includes(index))
        ),
      })),
    ],
  })
}

export function reportSectionHeading(text: string) {
  return new Paragraph({
    spacing: { before: 240, after: 100 },
    children: [new TextRun({ text, bold: true, size: 23, color: '1E3A5F', font: 'Arial' })],
  })
}

export function landscapeReport(children: Array<Paragraph | Table>) {
  return new Document({
    creator: 'Employee Management Portal',
    title: 'Báo cáo quản lý',
    description: 'Báo cáo được xuất từ hệ thống quản lý nhân viên.',
    styles: {
      default: {
        document: {
          run: { font: 'Arial', size: 18, color: '0F172A' },
          paragraph: { spacing: { after: 80, line: 260 } },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { orientation: PageOrientation.LANDSCAPE },
          margin: { top: 720, right: 600, bottom: 720, left: 600, header: 360, footer: 360 },
        },
      },
      children,
    }],
  })
}

export function statusLabel(value: unknown) {
  const labels: Record<string, string> = {
    Pending: 'Chờ duyệt',
    Approved: 'Đã duyệt',
    Rejected: 'Từ chối',
    Cancelled: 'Đã hủy',
    Registered: 'Đã đăng ký',
    Active: 'Đang áp dụng',
  }
  return labels[String(value)] || String(value || '')
}

export function shiftLabel(value: unknown) {
  return value === 'Morning' ? 'Ca sáng' : value === 'Afternoon' ? 'Ca chiều' : value === 'Evening' ? 'Ca tối' : ''
}

export function money(value: unknown) {
  return `${Number(value || 0).toLocaleString('vi-VN')}đ`
}

export function reportDate(value: unknown) {
  const candidate = value && typeof value === 'object' && 'toDate' in value
    ? (value as { toDate: () => Date }).toDate()
    : value instanceof Date
      ? value
      : new Date(String(value || ''))
  return candidate instanceof Date && !Number.isNaN(candidate.getTime())
    ? candidate.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
    : ''
}
