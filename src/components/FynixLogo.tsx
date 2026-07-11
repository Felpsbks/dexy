import { motion } from "framer-motion";

export function FynixLogo({ size = 32 }: { size?: number }) {
  return (
    <motion.svg
      initial={{ rotate: -8, scale: 0.9 }}
      animate={{ rotate: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 180, damping: 12 }}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
    >
      <defs>
        <linearGradient id="fynix-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.78 0.19 65)" />
          <stop offset="60%" stopColor="oklch(0.68 0.22 30)" />
          <stop offset="100%" stopColor="oklch(0.55 0.22 10)" />
        </linearGradient>
      </defs>
      <path
        d="M24 3c6 6 4 12 1 15 4-1 8-3 10-7 3 8-1 16-7 20 5 1 10-1 13-5-1 10-9 19-17 19S6 36 6 27c0-8 5-15 12-19-1 3 0 6 2 8 0-6 2-10 4-13Z"
        fill="url(#fynix-g)"
      />
      <circle cx="24" cy="30" r="4" fill="oklch(0.98 0.02 90)" opacity="0.9" />
    </motion.svg>
  );
}