import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/server/api-auth'
import { storeProfileImage } from '@/lib/server/google-drive-archive'

export const runtime = 'nodejs'

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

function hasValidSignature(bytes: Uint8Array, contentType: string) {
  if (contentType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (contentType === 'image/png') {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  }
  return contentType === 'image/webp' &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request)
    const form = await request.formData()
    const image = form.get('image')
    if (!(image instanceof File)) {
      return NextResponse.json({ error: 'Vui lòng chọn một ảnh.' }, { status: 400 })
    }
    if (!allowedTypes.has(image.type) || image.size < 1 || image.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Ảnh phải là JPG, PNG hoặc WebP và không quá 5 MB.' }, { status: 400 })
    }
    const bytes = new Uint8Array(await image.arrayBuffer())
    if (!hasValidSignature(bytes, image.type)) {
      return NextResponse.json({ error: 'Nội dung tệp không đúng định dạng ảnh.' }, { status: 400 })
    }
    const result = await storeProfileImage({
      employeeId: actor.uid,
      contentType: image.type as 'image/jpeg' | 'image/png' | 'image/webp',
      bytes: Buffer.from(bytes),
    })
    return NextResponse.json({ ok: true, url: result.url })
  } catch (error) {
    console.error('Google Drive profile image upload failed:', error)
    return NextResponse.json({ error: 'Chưa thể tải ảnh lên Google Drive.' }, { status: 500 })
  }
}
