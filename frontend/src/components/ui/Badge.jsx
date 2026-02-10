import React from 'react';
import { cn } from '../../lib/utils';

const Badge = ({ className, variant = 'default', ...props }) => {
  const variants = {
    default: 'border-transparent bg-green-500/10 text-green-400 border border-green-500/20',
    secondary: 'border-transparent bg-gray-800 text-gray-300 border border-gray-700',
    outline: 'text-gray-400 border border-gray-700',
    destructive: 'border-transparent bg-red-500/10 text-red-400 border border-red-500/20',
    warning: 'border-transparent bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
    info: 'border-transparent bg-blue-500/10 text-blue-400 border border-blue-500/20',
  };

  return (
    <div className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2', variants[variant], className)} {...props} />
  );
};

export default Badge;
