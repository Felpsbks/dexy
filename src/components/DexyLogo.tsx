import { motion } from "framer-motion";

export function DexyLogo({ size = 32 }: { size?: number }) {
  return (
    <motion.img
      src="/logo.webp"
      alt="Dexy"
      width={size}
      height={size}
      initial={{ rotate: -8, scale: 0.9 }}
      animate={{ rotate: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 180, damping: 12 }}
      style={{ width: size, height: size, objectFit: "contain" }}
      draggable={false}
    />
  );
}
