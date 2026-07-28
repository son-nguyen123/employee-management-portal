import { NextResponse } from 'next/server'
import { testGoogleDriveArchiveConnection } from '@/lib/server/google-drive-archive'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET chưa được cấu hình.' },
      { status: 503 },
    )
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json(
      { ok: false, error: 'Không có quyền chạy kiểm tra Drive.' },
      { status: 401 },
    )
  }

  try {
    const result = await testGoogleDriveArchiveConnection()
    return NextResponse.json({
      ok: true,
      result: {
        ...result,
        message: 'Đã tải file thử cực nhỏ lên Google Drive, xác minh và xóa thành công.',
      },
    })
  } catch (error) {
    console.error('Google Drive archive connection test failed:', error)
    const details = error instanceof Error ? error.message : ''
    const storageFull = details.includes('storageQuotaExceeded')
    return NextResponse.json(
      {
        ok: false,
        error: storageFull
          ? 'Google Drive của tài khoản đã đầy nên không thể tạo file lưu trữ.'
          : 'Không thể tạo file thử trên Google Drive. Kiểm tra lại OAuth và dung lượng Drive.',
      },
      { status: storageFull ? 507 : 500 },
    )
  }
}
