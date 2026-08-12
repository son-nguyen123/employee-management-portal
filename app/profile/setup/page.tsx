'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, Camera, Check, CreditCard, Crop, IdCard, ImageUp, Landmark, Link as LinkIcon, Loader2, LogOut, Move, Phone, Save, UserRound, X } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { auth } from '@/lib/firebase'
import { createEmployee, setInitialEmployeeScheduleMode, updateEmployee } from '@/lib/services/employeeService'
import { updateUserProfile } from '@/lib/services/authService'
import { profileImageUrl } from '@/lib/utils/profileImage'
import type { EmployeeScheduleMode } from '@/lib/models/types'

export default function ProfileSetupPage() {
  const router = useRouter()
  const { authUser, employee, isLoading, refreshEmployee, logout } = useAuth()
  const [form, setForm] = useState({
    fullName: '',
    employeeCode: '',
    phone: '',
    photoURL: '',
    facebookUrl: '',
    bankName: '',
    bankAccountName: '',
    bankAccountNumber: '',
    scheduleMode: 'rotating' as EmployeeScheduleMode,
  })
  const [saving, setSaving] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [pendingImage, setPendingImage] = useState<{ file: File; url: string; width: number; height: number } | null>(null)
  const [cropPosition, setCropPosition] = useState({ x: 50, y: 50 })
  const [cropZoom, setCropZoom] = useState(1)
  const [now, setNow] = useState(() => Date.now())
  const cropDrag = useRef<{ pointerId: number; x: number; y: number; positionX: number; positionY: number } | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!isLoading && !authUser) router.replace('/auth/login')
    if (!authUser) return
    setForm({
      fullName: employee?.fullName || authUser.displayName || '',
      employeeCode: employee?.employeeCode || '',
      phone: employee?.phone || '',
      photoURL: employee?.photoURL || authUser.photoURL || '',
      facebookUrl: employee?.facebookUrl || '',
      bankName: employee?.bankName || '',
      bankAccountName: employee?.bankAccountName || '',
      bankAccountNumber: employee?.bankAccountNumber || '',
      scheduleMode: employee?.scheduleMode || 'rotating',
    })
  }, [authUser, employee, isLoading, router])

  const setValue = (field: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [field]: value }))

  const closeImageEditor = () => {
    if (pendingImage) URL.revokeObjectURL(pendingImage.url)
    setPendingImage(null)
    setCropPosition({ x: 50, y: 50 })
    setCropZoom(1)
  }

  const chooseProfileImage = async (file?: File) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setMessage('Ảnh phải là JPG, PNG hoặc WebP và không quá 5 MB.')
      return
    }
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.src = url
    try {
      await image.decode()
      if (pendingImage) URL.revokeObjectURL(pendingImage.url)
      setPendingImage({ file, url, width: image.naturalWidth, height: image.naturalHeight })
      setCropPosition({ x: 50, y: 50 })
      setCropZoom(1)
      setMessage('')
    } catch {
      URL.revokeObjectURL(url)
      setMessage('Không thể đọc ảnh này. Vui lòng chọn ảnh khác.')
    }
  }

  const uploadProfileImage = async () => {
    if (!authUser || !pendingImage) return
    setUploadingImage(true)
    setMessage('')
    try {
      const outputSize = 512
      const scale = Math.max(outputSize / pendingImage.width, outputSize / pendingImage.height) * cropZoom
      const sourceWidth = outputSize / scale
      const sourceHeight = outputSize / scale
      const sourceX = (pendingImage.width - sourceWidth) * (cropPosition.x / 100)
      const sourceY = (pendingImage.height - sourceHeight) * (cropPosition.y / 100)
      const source = new Image()
      source.src = pendingImage.url
      await source.decode()
      const canvas = document.createElement('canvas')
      canvas.width = outputSize
      canvas.height = outputSize
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Thiết bị không hỗ trợ chỉnh ảnh.')
      context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputSize, outputSize)
      // JPEG is consistently supported by mobile Safari/Chrome. Some browsers
      // label a canvas export as WebP while returning different bytes, which
      // then fails the server-side file signature check.
      const contentType = 'image/jpeg'
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, contentType, 0.86))
      if (!blob) throw new Error('Không thể xử lý ảnh đã chọn.')

      const token = await auth.currentUser?.getIdToken()
      if (!token) throw new Error('Phiên đăng nhập đã hết hạn.')
      const body = new FormData()
      body.set('image', new File([blob], 'profile.jpg', { type: contentType }))
      const response = await fetch('/api/profile/image', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body,
      })
      const data = await response.json().catch(() => null) as { ok?: boolean; url?: string; oldImagesDeleted?: boolean; error?: string } | null
      if (!response.ok || !data?.url) throw new Error(data?.error || 'Chưa thể tải ảnh lên.')
      setValue('photoURL', data.url)
      await refreshEmployee()
      setMessage(data.oldImagesDeleted === false
        ? 'Ảnh mới đã được lưu. Chưa thể dọn ảnh cũ trên Google Drive, hệ thống sẽ thử lại ở lần đổi ảnh tiếp theo.'
        : 'Ảnh mới đã được lưu. Ảnh đại diện cũ đã được xóa khỏi Google Drive.')
      closeImageEditor()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể tải ảnh lên Google Drive.')
    } finally {
      setUploadingImage(false)
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!authUser) return
    const values = Object.fromEntries(
      Object.entries(form).map(([key, value]) => [key, value.trim()])
    ) as typeof form
    if (['fullName', 'employeeCode', 'phone', 'photoURL', 'facebookUrl'].some((key) => !values[key as keyof typeof values])) {
      setMessage('Vui lòng hoàn thiện đầy đủ thông tin cá nhân.')
      return
    }
    if (!/^https?:\/\//i.test(values.photoURL) || !/^https?:\/\//i.test(values.facebookUrl)) {
      setMessage('Link ảnh đại diện và Facebook phải bắt đầu bằng http:// hoặc https://.')
      return
    }
    const hasAnyBankValue = Boolean(values.bankName || values.bankAccountName || values.bankAccountNumber)
    if (hasAnyBankValue && !(values.bankName && values.bankAccountName && values.bankAccountNumber)) {
      setMessage('Nếu thêm tài khoản nhận lương, vui lòng điền đủ ngân hàng, tên chủ tài khoản và số tài khoản.')
      return
    }
    if (hasAnyBankValue && !/^\d{6,24}$/.test(values.bankAccountNumber.replace(/\s/g, ''))) {
      setMessage('Số tài khoản chỉ gồm 6–24 chữ số.')
      return
    }
    values.bankAccountNumber = values.bankAccountNumber.replace(/\s/g, '')
    setSaving(true)
    setMessage('')
    try {
      if (employee) {
        const { scheduleMode } = values
        const profileValues = {
          fullName: values.fullName,
          phone: values.phone,
          photoURL: values.photoURL,
          facebookUrl: values.facebookUrl,
          bankName: values.bankName,
          bankAccountName: values.bankAccountName,
          bankAccountNumber: values.bankAccountNumber,
        }
        const initialDeadline = employee.scheduleModeInitialSelectionDeadlineAt instanceof Date
          ? employee.scheduleModeInitialSelectionDeadlineAt
          : employee.scheduleModeInitialSelectionDeadlineAt?.toDate()
        const isInitialSelectionOpen = Boolean(initialDeadline && Date.now() < initialDeadline.getTime())
        if (scheduleMode !== (employee.scheduleMode || 'rotating') && !isInitialSelectionOpen) {
          throw new Error('Chế độ đã khóa. Vào Cá nhân để gửi yêu cầu quản lý.')
        }
        await updateEmployee(authUser.uid, profileValues)
        if (scheduleMode !== (employee.scheduleMode || 'rotating')) {
          await setInitialEmployeeScheduleMode(scheduleMode)
        }
      } else {
        await createEmployee(authUser.uid, {
          ...values,
          email: authUser.email || '',
          joinDate: new Date(),
          role: 'employee',
          status: 'active',
          scheduleMode: values.scheduleMode,
        })
      }
      if (!employee) await updateUserProfile(values.fullName, values.photoURL)
      await refreshEmployee()
      router.replace('/')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể lưu hồ sơ. Vui lòng thử lại.')
    } finally {
      setSaving(false)
    }
  }

  const switchAccount = async () => {
    setSigningOut(true)
    setMessage('')
    try {
      await logout()
      router.replace('/auth/login')
    } catch {
      setMessage('Chưa thể đăng xuất. Vui lòng thử lại.')
      setSigningOut(false)
    }
  }

  if (isLoading || !authUser) {
    return <main className="grid min-h-screen place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></main>
  }

  const fields = [
    { key: 'fullName' as const, label: 'Họ và tên', placeholder: 'Nguyễn Văn An', icon: UserRound },
    { key: 'employeeCode' as const, label: 'Mã nhân viên', placeholder: 'NV-001', icon: IdCard },
    { key: 'phone' as const, label: 'Số điện thoại', placeholder: '0901 234 567', icon: Phone },
    { key: 'facebookUrl' as const, label: 'Facebook', placeholder: 'https://facebook.com/ten-cua-ban', icon: LinkIcon },
  ]
  const bankOptions = [
    'Vietcombank', 'VietinBank', 'BIDV', 'Agribank', 'Techcombank', 'MB Bank',
    'ACB', 'VPBank', 'TPBank', 'Sacombank', 'HDBank', 'VIB', 'MSB', 'OCB',
    'SeABank', 'SHB', 'Eximbank', 'LienVietPostBank', 'Nam A Bank', 'VietBank',
    'VietABank', 'Bac A Bank', 'BaoViet Bank', 'KienlongBank', 'PVcomBank',
    'NCB', 'PGBank', 'SaigonBank', 'GPBank', 'OceanBank', 'Shinhan Bank',
  ]
  const initialDeadline = employee?.scheduleModeInitialSelectionDeadlineAt instanceof Date
    ? employee.scheduleModeInitialSelectionDeadlineAt
    : employee?.scheduleModeInitialSelectionDeadlineAt?.toDate()
  const isInitialSelectionOpen = Boolean(initialDeadline && now < initialDeadline.getTime())

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(217,70,239,.14),_transparent_34%),linear-gradient(180deg,_#f5f3ff_0%,_#f8fafc_48%,_#eef7ff_100%)] px-3 py-7 dark:bg-slate-950 dark:bg-none">
      <section className="mx-auto max-w-md overflow-hidden rounded-[2.25rem] border border-white/90 bg-white/95 shadow-[0_28px_80px_-35px_rgba(76,29,149,.55)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-900">
        <div
          className="relative overflow-hidden bg-gradient-to-br from-white via-fuchsia-50 to-violet-100 p-6 text-center text-slate-950"
          style={{
            backgroundImage: "linear-gradient(115deg, rgba(255,255,255,.96), rgba(253,230,245,.82)), url('/tricandy-logo-hd.png')",
            backgroundPosition: 'center, right -55px center',
            backgroundRepeat: 'no-repeat',
            backgroundSize: 'cover, 280px auto',
          }}
        >
          <div className="mx-auto grid h-16 w-16 place-items-center overflow-hidden rounded-3xl border-2 border-white bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white shadow-lg shadow-fuchsia-900/15">
            {form.photoURL ? <img src={profileImageUrl(form.photoURL)} alt="" className="h-full w-full object-cover" /> : <UserRound className="h-7 w-7" />}
          </div>
          <h1 className="mt-4 text-2xl font-black">Hoàn thiện hồ sơ</h1>
          <p className="mt-1 text-sm leading-6 text-slate-600">Chỉ cần làm một lần để quản lý nhận diện đúng tài khoản của bạn.</p>
        </div>

        <form onSubmit={submit} className="space-y-4 p-5 sm:p-6">
          {message && <p className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{message}</p>}
          <div className="rounded-3xl border border-indigo-100/90 bg-gradient-to-br from-indigo-50 to-sky-50/70 p-4 shadow-sm dark:border-indigo-500/20 dark:from-indigo-500/10 dark:to-sky-500/5">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white text-indigo-600 shadow-sm dark:bg-slate-900">
                {form.photoURL ? <img src={profileImageUrl(form.photoURL)} alt="" className="h-full w-full object-cover" /> : <Camera className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1"><h2 className="font-extrabold">Ảnh đại diện</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">JPG, PNG hoặc WebP · tối đa 5 MB. Ảnh lưu trên Google Drive, Firebase chỉ giữ đường dẫn.</p></div>
            </div>
            <label className="mt-3 flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-rose-500 px-4 text-sm font-black text-white shadow-lg shadow-fuchsia-600/20 transition hover:brightness-105 active:scale-[0.98]">
              {uploadingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />}
              {uploadingImage ? 'Đang tải lên...' : form.photoURL ? 'Đổi ảnh' : 'Chọn ảnh'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={uploadingImage || saving || signingOut}
                onChange={(event) => {
                  void chooseProfileImage(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
            </label>
          </div>
          {fields.map(({ key, label, placeholder, icon: Icon }) => (
            <label key={key} className="block text-sm font-black text-slate-950 dark:text-slate-100">
              {label}
              <div className="relative mt-2">
                <Icon className="absolute left-4 top-3.5 h-5 w-5 text-muted-foreground" />
                <input value={form[key]} onChange={(event) => setValue(key, event.target.value)} className="mobile-field !rounded-2xl !border-slate-200 !bg-slate-50/60 !pl-12 !font-semibold focus:!border-fuchsia-400 focus:!ring-fuchsia-200" placeholder={placeholder} disabled={saving || signingOut || (key === 'employeeCode' && Boolean(employee))} required />
              </div>
            </label>
          ))}
          <div className="rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 via-white to-sky-50/80 p-4 shadow-sm dark:border-violet-500/20 dark:from-violet-500/10 dark:via-slate-900 dark:to-sky-500/5">
            <div className="mb-4 flex items-center gap-2">
              <Landmark className="h-5 w-5 text-indigo-600" />
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-extrabold">Tài khoản nhận lương</h2><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-indigo-600 shadow-sm dark:bg-slate-900">Không bắt buộc</span></div><p className="mt-1 text-xs text-muted-foreground">Chỉ cần nhập khi bạn muốn nhận lương hoặc ứng lương qua ngân hàng.</p></div>
            </div>
            <label className="block text-sm font-black text-slate-950 dark:text-slate-100">
              Ngân hàng
              <select value={form.bankName} onChange={(event) => setValue('bankName', event.target.value)} className="mobile-field mt-2 !rounded-2xl !border-violet-100 !bg-white !font-semibold focus:!border-violet-400 focus:!ring-violet-200" disabled={saving || signingOut}>
                <option value="">Chọn ngân hàng</option>
                {bankOptions.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
              </select>
            </label>
            <label className="mt-4 block text-sm font-black text-slate-950 dark:text-slate-100">
              Tên chủ tài khoản
              <div className="relative mt-2">
                <UserRound className="absolute left-4 top-3.5 h-5 w-5 text-muted-foreground" />
                <input value={form.bankAccountName} onChange={(event) => setValue('bankAccountName', event.target.value)} className="mobile-field !pl-12 uppercase" placeholder="NGUYỄN VĂN AN" disabled={saving || signingOut} />
              </div>
            </label>
            <label className="mt-4 block text-sm font-black text-slate-950 dark:text-slate-100">
              Số tài khoản
              <div className="relative mt-2">
                <CreditCard className="absolute left-4 top-3.5 h-5 w-5 text-muted-foreground" />
                <input value={form.bankAccountNumber} onChange={(event) => setValue('bankAccountNumber', event.target.value.replace(/[^\d\s]/g, ''))} inputMode="numeric" className="mobile-field !pl-12" placeholder="Nhập số tài khoản" disabled={saving || signingOut} />
              </div>
            </label>
          </div>
          <section className="rounded-3xl border border-fuchsia-100 bg-gradient-to-br from-fuchsia-50 to-violet-50/80 p-4 shadow-sm dark:border-fuchsia-500/20 dark:from-fuchsia-500/10 dark:to-violet-500/10">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-600 text-white"><CalendarDays className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1"><h2 className="font-extrabold">Cách xếp lịch làm</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Lịch cố định được tự động xác nhận và lặp lại theo tuần. Xoay ca sẽ đăng ký lại từng tuần.</p></div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-white/80 p-1 dark:bg-slate-900/70">
              {([['rotating', 'Xoay ca', 'Đăng ký từng tuần'], ['fixed', 'Làm cố định', 'Tự động lặp lại']] as const).map(([mode, label, description]) => (
                <button key={mode} type="button" onClick={() => setForm((current) => ({ ...current, scheduleMode: mode }))} disabled={saving || signingOut || Boolean(employee && !isInitialSelectionOpen)} className={`rounded-xl px-2 py-3 text-left transition ${form.scheduleMode === mode ? 'bg-violet-600 text-white shadow-md' : 'text-slate-600 hover:bg-violet-50 dark:text-slate-300 dark:hover:bg-violet-500/10'} disabled:cursor-not-allowed disabled:opacity-70`}>
                  <span className="block text-sm font-black">{label}</span><span className={`mt-1 block text-[10px] font-semibold ${form.scheduleMode === mode ? 'text-white/80' : 'text-muted-foreground'}`}>{description}</span>
                </button>
              ))}
            </div>
            {employee && !isInitialSelectionOpen && <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">Chế độ đã khóa. Vào mục Cá nhân để gửi yêu cầu quản lý; thay đổi chỉ áp dụng từ tuần kế tiếp.</p>}
            {employee && isInitialSelectionOpen && initialDeadline && <p className="mt-3 rounded-2xl bg-white/75 px-3 py-2 text-xs font-bold leading-5 text-violet-800 dark:bg-slate-900/60 dark:text-violet-200">Bạn có thể chọn chế độ ban đầu đến {initialDeadline.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ngày {initialDeadline.toLocaleDateString('vi-VN')}.</p>}
          </section>
          <button type="submit" disabled={saving} className="mobile-primary-button mt-2 !bg-gradient-to-r !from-violet-600 !via-fuchsia-600 !to-rose-500 shadow-xl shadow-fuchsia-600/20">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Đang lưu...' : 'Lưu và tiếp tục'}
          </button>
          <button
            type="button"
            onClick={switchAccount}
            disabled={saving || signingOut}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 font-bold text-slate-700 transition active:scale-[0.98] disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            {signingOut ? 'Đang đăng xuất...' : 'Đăng xuất / dùng tài khoản khác'}
          </button>
        </form>
      </section>
      {pendingImage && (() => {
        const previewSize = 260
        const previewScale = Math.max(previewSize / pendingImage.width, previewSize / pendingImage.height) * cropZoom
        const renderedWidth = pendingImage.width * previewScale
        const renderedHeight = pendingImage.height * previewScale
        return (
          <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/65 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => !uploadingImage && closeImageEditor()}>
            <section role="dialog" aria-modal="true" aria-labelledby="profile-image-editor-title" className="w-full max-w-md overflow-hidden rounded-t-[2rem] bg-white shadow-2xl dark:bg-slate-900 sm:rounded-[2rem]" onClick={(event) => event.stopPropagation()}>
              <header className="flex items-center gap-3 border-b border-slate-100 p-4 dark:border-white/10">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10"><Crop className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Ảnh đại diện</p><h2 id="profile-image-editor-title" className="text-lg font-black">Căn vị trí ảnh</h2></div>
                <button type="button" onClick={closeImageEditor} disabled={uploadingImage} aria-label="Đóng chỉnh ảnh" className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 disabled:opacity-50 dark:bg-slate-800"><X className="h-4 w-4" /></button>
              </header>
              <div className="p-4">
                <div
                  className="mx-auto touch-none overflow-hidden rounded-full bg-slate-100 ring-4 ring-indigo-100 active:cursor-grabbing dark:bg-slate-800 dark:ring-indigo-500/20"
                  style={{ width: previewSize, height: previewSize }}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId)
                    cropDrag.current = {
                      pointerId: event.pointerId,
                      x: event.clientX,
                      y: event.clientY,
                      positionX: cropPosition.x,
                      positionY: cropPosition.y,
                    }
                  }}
                  onPointerMove={(event) => {
                    const drag = cropDrag.current
                    if (!drag || drag.pointerId !== event.pointerId) return
                    const overflowX = Math.max(1, renderedWidth - previewSize)
                    const overflowY = Math.max(1, renderedHeight - previewSize)
                    setCropPosition({
                      x: Math.max(0, Math.min(100, drag.positionX - ((event.clientX - drag.x) / overflowX) * 100)),
                      y: Math.max(0, Math.min(100, drag.positionY - ((event.clientY - drag.y) / overflowY) * 100)),
                    })
                  }}
                  onPointerUp={() => { cropDrag.current = null }}
                  onPointerCancel={() => { cropDrag.current = null }}
                >
                  <div className="relative h-full w-full cursor-grab overflow-hidden">
                    <img
                      src={pendingImage.url}
                      alt="Xem trước ảnh đại diện"
                      className="pointer-events-none absolute max-w-none select-none"
                      style={{
                        width: renderedWidth,
                        height: renderedHeight,
                        left: (previewSize - renderedWidth) * (cropPosition.x / 100),
                        top: (previewSize - renderedHeight) * (cropPosition.y / 100),
                      }}
                    />
                  </div>
                </div>
                <p className="mt-4 flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground"><Move className="h-4 w-4" /> Kéo trực tiếp ảnh để căn vị trí</p>
                <div className="mt-4 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800">
                  <label className="block text-xs font-bold">Phóng to<input type="range" min="1" max="2.5" step="0.05" value={cropZoom} onChange={(event) => setCropZoom(Number(event.target.value))} className="mt-2 w-full accent-indigo-600" /></label>
                </div>
              </div>
              <footer className="grid grid-cols-[auto_1fr] gap-2 border-t border-slate-100 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-white/10">
                <button type="button" onClick={closeImageEditor} disabled={uploadingImage} className="min-h-12 rounded-2xl border border-slate-200 px-4 font-bold disabled:opacity-50 dark:border-slate-700">Chọn lại</button>
                <button type="button" onClick={() => void uploadProfileImage()} disabled={uploadingImage} className="mobile-primary-button">
                  {uploadingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {uploadingImage ? 'Đang lưu ảnh...' : 'Xác nhận ảnh'}
                </button>
              </footer>
            </section>
          </div>
        )
      })()}
    </main>
  )
}
