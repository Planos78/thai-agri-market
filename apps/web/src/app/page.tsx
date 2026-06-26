"use client";

import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import { useRef, useState, useEffect } from "react";
import { 
  Leaf, ShieldCheck, Truck, Database, 
  Smartphone, Wallet, QrCode, Globe,
  Cpu, Sparkles, ChevronRight, ArrowRight
} from "lucide-react";

// Apple-like animations
const fadeInUp = {
  hidden: { opacity: 0, y: 40, filter: "blur(10px)" },
  visible: { 
    opacity: 1, y: 0, filter: "blur(0px)",
    transition: { duration: 1.2, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }
  }
};

const stagger = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.2 }
  }
};

function HeroSection() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "40%"]);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.05]);

  return (
    <div ref={ref} className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-[#000000]">
      {/* Apple Intelligence / Siri Glow Effect */}
      <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none opacity-50 mix-blend-screen">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute w-[80vw] h-[80vw] max-w-[800px] max-h-[800px] rounded-full blur-[100px] md:blur-[140px] transform-gpu"
          style={{
            background: "conic-gradient(from 180deg at 50% 50%, #FFB067 0deg, #FF705B 72deg, #D442F5 144deg, #4A6CFF 216deg, #42D4F5 288deg, #FFB067 360deg)"
          }}
        />
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[50px] transform-gpu" />
      </div>

      <motion.div style={{ y, opacity, scale }} className="relative z-10 flex flex-col items-center text-center px-4 mt-20 transform-gpu">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, delay: 0.2 }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 backdrop-blur-md mb-8"
        >
          <Sparkles className="w-4 h-4 text-[#FFB067]" />
          <span className="text-[11px] font-medium tracking-widest uppercase text-white/80">ระบบล้งดิจิทัลอัจฉริยะ</span>
        </motion.div>

        <motion.h1 
          initial={{ opacity: 0, y: 20, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 1.2, delay: 0.4, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
          className="text-[80px] sm:text-[120px] md:text-[200px] font-semibold tracking-tighter leading-[0.9] text-transparent bg-clip-text bg-gradient-to-b from-white via-white/90 to-white/20 mb-8"
        >
          ล้ำหน้า.<br />ที่สุด.
        </motion.h1>
        
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, delay: 0.6, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
          className="text-xl md:text-3xl font-medium text-[#86868B] tracking-tight max-w-2xl leading-snug"
        >
          ปฏิวัติวงการผลไม้ไทย ด้วยเทคโนโลยีแห่งอนาคต<br className="hidden md:block"/>ส่งตรงจากสวน ถึงมือคุณอย่างสมบูรณ์แบบ
        </motion.p>
      </motion.div>
    </div>
  );
}

function TitaniumSection() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  
  const videoScale = useTransform(scrollYProgress, [0, 0.5], [0.8, 1]);
  const videoOpacity = useTransform(scrollYProgress, [0, 0.3], [0, 1]);

  return (
    <div ref={ref} className="relative py-32 md:py-64 bg-black overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 md:px-8 text-center flex flex-col items-center">
        <motion.div 
          initial={{ opacity: 0, y: 50 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
        >
          <h2 className="text-4xl md:text-7xl font-semibold tracking-tighter text-[#C4B5A5] mb-6">
            ออกแบบใหม่หมด.<br />ด้วยโครงสร้างระดับชาติ.
          </h2>
          <p className="text-xl text-[#86868B] font-medium tracking-tight max-w-3xl mx-auto mb-20">
            สร้างสรรค์จากแนวคิดตลาดเสรี เพื่อทลายการผูกขาด แข็งแกร่ง โปร่งใส และทรงพลังที่สุดเท่าที่เคยมีมา
          </p>
        </motion.div>

        <motion.div 
          style={{ scale: videoScale, opacity: videoOpacity }}
          className="w-full aspect-video max-w-5xl rounded-[2rem] md:rounded-[4rem] border border-[#C4B5A5]/20 bg-gradient-to-b from-[#1C1C1E] to-black shadow-[0_0_100px_rgba(196,181,165,0.1)] relative overflow-hidden flex items-center justify-center group transform-gpu"
        >
          <div className="absolute inset-0 bg-gradient-to-tr from-[#C4B5A5]/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-duration-1000" />
          <Cpu className="w-24 h-24 text-[#C4B5A5]/50 relative z-10" strokeWidth={1} />
        </motion.div>
      </div>
    </div>
  );
}

function IntelligenceBento() {
  return (
    <div className="py-32 md:py-48 px-4 md:px-8 bg-[#000000]">
      <div className="max-w-7xl mx-auto">
        <div className="mb-20">
          <h2 className="text-5xl md:text-[80px] font-semibold tracking-tighter text-white leading-[0.9]">
            ฉลาดล้ำ.<br />ในทุกขั้นตอน.
          </h2>
        </div>

        <motion.div 
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 auto-rows-[minmax(300px,auto)]"
        >
          {/* Main Card */}
          <motion.div variants={fadeInUp} className="md:col-span-2 md:row-span-2 bg-[#111111] border border-white/5 rounded-[3rem] p-10 md:p-16 relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
            <Smartphone className="w-12 h-12 text-white mb-8" strokeWidth={1.5} />
            <div className="relative z-10 mt-auto pt-40 md:pt-60">
              <h3 className="text-3xl md:text-5xl font-semibold text-white mb-4 tracking-tight">แอปพลิเคชันที่รู้ใจ<br />กว่าที่เคย</h3>
              <p className="text-[#86868B] text-lg md:text-xl font-medium max-w-md">ระบบประมวลผลอัจฉริยะ แนะนำผลไม้ตามฤดูกาลและจับคู่ชาวสวนที่ตรงใจคุณที่สุด</p>
            </div>
          </motion.div>

          {/* Small Card 1 */}
          <motion.div variants={fadeInUp} className="bg-[#111111] border border-white/5 rounded-[3rem] p-10 flex flex-col relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
            <Leaf className="w-10 h-10 text-emerald-400 mb-8" strokeWidth={1.5} />
            <div className="mt-auto">
              <h3 className="text-2xl font-semibold text-white mb-2">คุณภาพที่<br/>สัมผัสได้</h3>
              <p className="text-[#86868B] font-medium">มาตรฐานเกรดส่งออก คัดสรรอย่างพิถีพิถันจากสวน</p>
            </div>
          </motion.div>

          {/* Small Card 2 */}
          <motion.div variants={fadeInUp} className="bg-[#111111] border border-white/5 rounded-[3rem] p-10 flex flex-col relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-b from-amber-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
            <Truck className="w-10 h-10 text-amber-400 mb-8" strokeWidth={1.5} />
            <div className="mt-auto">
              <h3 className="text-2xl font-semibold text-white mb-2">จัดส่ง<br/>สายฟ้าแลบ</h3>
              <p className="text-[#86868B] font-medium">ระบบ API ขนส่งด่วน ควบคุมอุณหภูมิตลอดเส้นทาง</p>
            </div>
          </motion.div>

          {/* Wide Card */}
          <motion.div variants={fadeInUp} className="md:col-span-3 bg-gradient-to-r from-[#1A1A1C] to-[#111111] border border-white/5 rounded-[3rem] p-10 md:p-16 flex flex-col md:flex-row items-center justify-between overflow-hidden relative">
            <div className="absolute right-0 top-0 w-1/2 h-full bg-gradient-to-l from-white/5 to-transparent pointer-events-none" />
            <div className="max-w-xl relative z-10">
              <ShieldCheck className="w-12 h-12 text-white mb-6" strokeWidth={1.5} />
              <h3 className="text-3xl md:text-5xl font-semibold text-white mb-4 tracking-tight">โปร่งใสที่สุด.<br/>ด้วยระบบ Smart Escrow.</h3>
              <p className="text-[#86868B] text-xl font-medium">แยกรายได้ทันทีเมื่อสินค้าถึงมือ ระบบยุติธรรมที่ทุกคนได้ประโยชน์ ไม่มีการผูกขาดอีกต่อไป</p>
            </div>
            
            <div className="mt-12 md:mt-0 relative z-10 flex gap-4 bg-black/50 p-6 rounded-[2rem] border border-white/5 backdrop-blur-xl">
               <div className="text-center px-4">
                 <span className="block text-[#86868B] text-xs font-bold uppercase tracking-widest mb-2">ชาวสวน</span>
                 <span className="block text-white text-3xl font-semibold">90%</span>
               </div>
               <div className="w-[1px] bg-white/10" />
               <div className="text-center px-4">
                 <span className="block text-[#86868B] text-xs font-bold uppercase tracking-widest mb-2">ระบบ</span>
                 <span className="block text-white text-3xl font-semibold">10%</span>
               </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}

function PerformanceSection() {
  return (
    <div className="relative py-32 md:py-64 bg-black overflow-hidden flex items-center justify-center">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.03)_0%,transparent_70%)]" />
      
      <div className="text-center relative z-10 max-w-4xl px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, filter: "blur(10px)" }}
          whileInView={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          viewport={{ once: true }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
        >
          <Database className="w-20 h-20 text-white mx-auto mb-10" strokeWidth={1} />
          <h2 className="text-5xl md:text-[100px] font-semibold tracking-tighter text-white leading-[0.9] mb-8">
            ทรงพลังระดับชาติ.
          </h2>
          <p className="text-xl md:text-3xl text-[#86868B] font-medium tracking-tight leading-snug">
            ขุมพลัง API Gateway ใหม่ เชื่อมต่อทุกระบบศุลกากร ขนส่ง และชาวสวนเข้าด้วยกันอย่างสมบูรณ์แบบ เร็วกว่าที่เคย
          </p>
        </motion.div>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="bg-[#111111] pt-32 pb-16 px-4 md:px-8 border-t border-white/5">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col items-center text-center mb-32">
          <h2 className="text-4xl md:text-6xl font-semibold text-white tracking-tighter mb-8">
            ถึงเวลาเปลี่ยน<br/>อนาคตผลไม้ไทย
          </h2>
          <motion.button 
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="bg-white text-black px-8 py-4 rounded-full font-semibold text-lg flex items-center gap-2 hover:bg-[#E8E8ED] transition-colors"
          >
            เริ่มต้นใช้งาน <ArrowRight className="w-5 h-5" />
          </motion.button>
        </div>

        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-[#86868B] text-xs font-medium tracking-wide">
            Copyright © 2026 National Agri-Market. All rights reserved.
          </p>
          <div className="flex gap-6 text-[#86868B] text-xs font-medium">
            <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-white transition-colors">Terms of Use</a>
            <a href="#" className="hover:text-white transition-colors">Legal</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function AppLanding() {
  return (
    <main className="bg-black selection:bg-white/20 font-sans antialiased min-h-screen text-white overflow-x-hidden">
      <HeroSection />
      <TitaniumSection />
      <IntelligenceBento />
      <PerformanceSection />
      <Footer />
    </main>
  );
}
