'use client'

import React from 'react'

interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full'
  padded?: boolean
}

const PageContainer = React.forwardRef<HTMLDivElement, PageContainerProps>(
  (
    {
      className = '',
      maxWidth = 'xl',
      padded = true,
      children,
      ...props
    },
    ref
  ) => {
    const maxWidthStyles = {
      sm: 'max-w-sm',
      md: 'max-w-md',
      lg: 'max-w-lg',
      xl: 'max-w-2xl md:max-w-3xl lg:max-w-4xl',
      '2xl': 'max-w-4xl lg:max-w-6xl',
      full: 'w-full',
    }

    const paddingStyles = padded ? 'px-3 py-4 sm:px-6 sm:py-8 lg:px-8' : ''

    return (
      <div
        ref={ref}
        className={`mx-auto w-full ${maxWidthStyles[maxWidth]} ${paddingStyles} ${className}`}
        {...props}
      >
        {children}
      </div>
    )
  }
)
PageContainer.displayName = 'PageContainer'

export { PageContainer }
