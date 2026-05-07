import React from "react";
import { motion, AnimatePresence } from "framer-motion";

const RIVER_BALL = "https://static.prod-images.emergentagent.com/jobs/5b062d42-aa16-478f-9904-4c1a14748b37/images/0e5d9cd254c7af67a52924c927b4fb710091bea4bdb211921ad2c64510b4c327.png";

export default function BallCounter({ balance, delta, onClick, className = "" }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`glass-dark rounded-full pl-2 pr-3 sm:pl-2.5 sm:pr-4 h-10 sm:h-11 flex items-center gap-1.5 sm:gap-2 font-bold text-sm sm:text-base relative ${className}`}
            data-testid="ball-counter"
        >
            <img src={RIVER_BALL} alt="" className="w-5 h-5 sm:w-6 sm:h-6" draggable={false} />
            <span className="tabular-nums" data-testid="ball-balance">{balance ?? "—"}</span>
            <AnimatePresence>
                {delta != null && delta !== 0 && (
                    <motion.span
                        key={`${delta}-${Date.now()}`}
                        initial={{ y: 0, opacity: 1 }}
                        animate={{ y: -28, opacity: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1.4 }}
                        className={`absolute -top-1 right-2 text-xs font-heading font-bold ${delta > 0 ? "text-emerald-300" : "text-rose-300"}`}
                    >
                        {delta > 0 ? `+${delta}` : delta}
                    </motion.span>
                )}
            </AnimatePresence>
        </button>
    );
}
