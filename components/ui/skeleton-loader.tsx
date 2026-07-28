'use client'

import React from 'react'

interface SkeletonLoaderProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'card' | 'avatar' | 'button' | 'line'
  count?: number
}

const SkeletonLoader = React.forwardRef<HTMLDivElement, SkeletonLoaderProps>(
  ({ className = '', variant = 'text', count = 1, ...props }, ref) => {
    const baseStyles = 'animate-pulse bg-muted rounded'

    const variantStyles = {
      text: 'h-4 w-full mb-2',
      card: 'h-48 w-full rounded-2xl mb-4',
      avatar: 'h-12 w-12 rounded-full',
      button: 'h-10 w-24 rounded-lg',
      line: 'h-3 w-full mb-3',
    }

    const skeletons = Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className={`${baseStyles} ${variantStyles[variant]}`}
        style={{
          backgroundImage: 'linear-gradient(90deg, hsl(var(--muted)) 25%, hsl(var(--muted)/80%) 50%, hsl(var(--muted)) 75%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 2s infinite',
        }}
      />
    ))

    return (
      <div ref={ref} className={className} {...props}>
        {skeletons}
      </div>
    )
  }
)
SkeletonLoader.displayName = 'SkeletonLoader'

export { SkeletonLoader }
