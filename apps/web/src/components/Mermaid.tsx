"use client";

import React, { useEffect, useState } from 'react';
import mermaid from 'mermaid';

export default function Mermaid({ chart }: { chart: string }) {
  const [svg, setSvg] = useState<string>('');

  useEffect(() => {
    mermaid.initialize({ 
      startOnLoad: false, 
      theme: 'base',
      themeVariables: {
        darkMode: true,
        background: 'transparent',
        primaryColor: '#064e3b', // emerald-900
        primaryTextColor: '#f8fafc',
        primaryBorderColor: '#10b981', // emerald-500
        lineColor: '#34d399', // emerald-400
        secondaryColor: '#1e293b',
        tertiaryColor: '#0f172a',
      },
      fontFamily: 'Prompt, sans-serif'
    });

    const renderChart = async () => {
      try {
        const id = 'mermaid-svg-' + Math.random().toString(36).substr(2, 9);
        const { svg } = await mermaid.render(id, chart);
        setSvg(svg);
      } catch (error) {
        console.error('Mermaid render error', error);
      }
    };

    renderChart();
  }, [chart]);

  if (!svg) {
    return <div className="animate-pulse w-full h-64 bg-slate-800/50 rounded-2xl border border-slate-700 flex items-center justify-center text-slate-500">Loading Flowchart...</div>;
  }

  return (
    <div 
      className="flex justify-center my-8 overflow-x-auto p-6 bg-slate-900/40 border border-slate-800 rounded-3xl shadow-[0_0_30px_rgba(16,185,129,0.05)]"
      dangerouslySetInnerHTML={{ __html: svg }} 
    />
  );
}
