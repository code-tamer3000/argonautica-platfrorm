import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'gold' | 'outline' | 'danger'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export function Button({ variant = 'gold', className = '', ...rest }: Props) {
  return <button className={`btn btn-${variant} ${className}`} {...rest} />
}
