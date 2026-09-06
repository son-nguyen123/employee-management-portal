import ExcelJS from 'exceljs'

export const REPORT_THIN_BLACK_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
}

export const REPORT_XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function configureReportSheet(
  sheet: ExcelJS.Worksheet,
  columns: Array<{ key: string; width: number }>,
  freezeRows = 3,
) {
  sheet.views = [{ state: 'frozen', ySplit: freezeRows, showGridLines: true }]
  sheet.properties.defaultRowHeight = 22
  sheet.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  }
  sheet.columns = columns
}

export function styleReportTitle(sheet: ExcelJS.Worksheet, lastColumn: string, title: string, rowNumber = 2) {
  sheet.mergeCells(`A${rowNumber}:${lastColumn}${rowNumber}`)
  const cell = sheet.getCell(`A${rowNumber}`)
  cell.value = title
  cell.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FF000000' } }
  cell.alignment = { horizontal: 'center', vertical: 'middle' }
  sheet.getRow(rowNumber).height = 34.5
}

export function styleReportHeader(row: ExcelJS.Row, headers: string[]) {
  row.values = headers
  row.height = 30
  row.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF000000' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = REPORT_THIN_BLACK_BORDER
  })
}

export function styleReportBodyRow(
  row: ExcelJS.Row,
  columnCount: number,
  options: { centerColumns?: number[]; wrapColumns?: number[]; stripe?: boolean } = {},
) {
  const centerColumns = options.centerColumns || []
  const wrapColumns = options.wrapColumns || []
  row.height = 24
  for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
    const cell = row.getCell(columnNumber)
    cell.font = { name: 'Arial', size: 10, color: { argb: 'FF000000' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: options.stripe ? 'FFF8FAFC' : 'FFFFFFFF' } }
    cell.alignment = {
      vertical: 'middle',
      horizontal: centerColumns.includes(columnNumber) ? 'center' : 'left',
      wrapText: wrapColumns.includes(columnNumber),
    }
    cell.border = REPORT_THIN_BLACK_BORDER
  }
}

export function styleReportTotalRow(
  sheet: ExcelJS.Worksheet,
  rowNumber: number,
  columnCount: number,
  totalColumn: number,
  labelEndColumn: number,
  total: number,
) {
  const totalRow = sheet.getRow(rowNumber)
  for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
    const cell = totalRow.getCell(columnNumber)
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF000000' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
    cell.alignment = { horizontal: columnNumber === totalColumn ? 'right' : 'center', vertical: 'middle' }
    cell.border = REPORT_THIN_BLACK_BORDER
  }
  const labelEnd = String.fromCharCode(64 + labelEndColumn)
  sheet.mergeCells(`A${rowNumber}:${labelEnd}${rowNumber}`)
  sheet.getCell(`A${rowNumber}`).value = 'TỔNG'
  sheet.getCell(`${String.fromCharCode(64 + totalColumn)}${rowNumber}`).value = total
  sheet.getCell(`${String.fromCharCode(64 + totalColumn)}${rowNumber}`).numFmt = '#,##0'
  totalRow.height = 24
}
