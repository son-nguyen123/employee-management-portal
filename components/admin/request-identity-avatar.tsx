'use client'

import type { LucideIcon } from 'lucide-react'
import { UserRound } from 'lucide-react'
import Image from 'next/image'
import { profileImageUrl } from '@/lib/utils/profileImage'

function initials(name: string) {
  return name.trim().split(/\s+/).slice(-2).map((part) => part[0]).join('').toLocaleUpperCase('vi') || 'NV'
}

export function RequestIdentityAvatar({
  name,
  photoURL,
  icon: Icon,
  iconColor,
}: {
  name: string
  photoURL?: string
  icon: LucideIcon
  iconColor: string
}) {
  return (
    <div className="relative h-14 w-14 shrink-0">
      <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-full bg-slate-900 text-sm font-black text-white shadow-sm">
        {photoURL
          ? <Image src={profileImageUrl(photoURL)} alt={`Ảnh đại diện của ${name}`} width={56} height={56} className="h-full w-full object-cover" />
          : name ? initials(name) : <UserRound className="h-5 w-5" />}
      </div>
      <span className={`absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full border-2 border-white text-white shadow-md dark:border-slate-900 ${iconColor}`}>
        <Icon className="h-4 w-4" />
      </span>
    </div>
  )
}
