import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import sharp from 'sharp'
import { ApiError } from '@/lib/server/api-auth'
import { adminAuth, adminDb } from '@/lib/server/firebase-admin'
import {
  deleteOtherProfileImages,
  deleteProfileImage,
  readProfileImage,
  storeProfileImage,
} from '@/lib/server/google-drive-archive'

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
    const authorization = request.headers.get('authorization')
    if (!authorization?.startsWith('Bearer ')) throw new ApiError(401, 'Bạn cần đăng nhập để tải ảnh.')
    const token = await adminAuth.verifyIdToken(authorization.slice(7), true)
    const profileRef = adminDb.collection('employees').doc(token.uid)
    const profile = await profileRef.get()
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
    const uploadedFile = await storeProfileImage({
      employeeId: token.uid,
      contentType: image.type as 'image/jpeg' | 'image/png' | 'image/webp',
      bytes: Buffer.from(bytes),
    })
    const displayUrl = new URL('/api/profile/image', request.url)
    displayUrl.searchParams.set('fileId', uploadedFile.id)
    const photoURL = displayUrl.toString()

    try {
      if (profile.exists) await profileRef.update({ photoURL, updatedAt: FieldValue.serverTimestamp() })
    } catch (error) {
      await deleteProfileImage(token.uid, uploadedFile.id).catch((cleanupError) => {
        console.error('Failed to roll back a new Google Drive profile image:', cleanupError)
      })
      throw error
    }

    await adminAuth.updateUser(token.uid, { photoURL }).catch((error) => {
      console.error('Firebase Auth profile image sync failed:', error)
    })
    let oldImagesDeleted = true
    try {
      await deleteOtherProfileImages(token.uid, uploadedFile.id)
    } catch (error) {
      oldImagesDeleted = false
      console.error('Old Google Drive profile image cleanup failed:', error)
    }

    return NextResponse.json(
      { ok: true, url: photoURL, oldImagesDeleted },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    console.error('Google Drive profile image upload failed:', error)
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Chưa thể lưu ảnh mới. Ảnh cũ vẫn được giữ nguyên.' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const fileId = new URL(request.url).searchParams.get('fileId') || ''
    const image = await readProfileImage(fileId)
    const optimized = await sharp(image.bytes)
      .rotate()
      .resize(256, 256, { fit: 'cover', position: 'centre', withoutEnlargement: true })
      .webp({ quality: 80, effort: 3 })
      .toBuffer()
    return new Response(optimized, {
      headers: {
        'content-type': 'image/webp',
        'cache-control': 'public, max-age=31536000, s-maxage=31536000, immutable',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return new Response(null, { status: 404 })
  }
}
