import { useEffect, useState, useRef, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

export default function KnowledgeGraph({ onNodeClick }: { onNodeClick?: (id: string) => void }) {
  const [data, setData] = useState<GraphData | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const graphRef = useRef<any>();

  useEffect(() => {
    window.electronAPI.getGraphData().then(setData);
  }, []);

  // Handle responsive resizing
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      setDimensions({
        width: entries[0].contentRect.width,
        height: entries[0].contentRect.height
      });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const handleNodeClick = useCallback((node: any) => {
    if (onNodeClick) onNodeClick(node.name);
  }, [onNodeClick]);

  if (!data) return <div className="flex-1 flex items-center justify-center text-textMuted">Compiling topological embeddings...</div>;

  const getLinkColor = (link: any) => {
    switch (link.type) {
      case 'explicit': return '#818cf8'; // Indigo
      case 'tag': return '#34d399';      // Emerald
      case 'similarity': return 'rgba(255, 255, 255, 0.1)';
      default: return 'rgba(255, 255, 255, 0.15)';
    }
  };

  const getLinkWidth = (link: any) => {
    switch (link.type) {
      case 'explicit': return 2;
      case 'tag': return 1.5;
      case 'similarity': return 1;
      default: return 1;
    }
  };

  return (
    <div ref={containerRef} className="w-full h-full relative bg-surface/50 rounded-2xl overflow-hidden border border-border shadow-inner">
      {data.nodes.length < 2 && (
        <div className="absolute inset-0 flex items-center justify-center text-textMuted z-10 pointer-events-none">
          Add at least two notes to the Vault to visualize their structural affinities.
        </div>
      )}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 bg-background/80 backdrop-blur p-3 rounded-lg border border-border text-[10px] uppercase tracking-wider font-bold">
        <div className="flex items-center gap-2">
          <div className="w-3 h-0.5 bg-[#818cf8]"></div>
          <span className="text-textMain">Explicit Link</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-0.5 bg-[#34d399] border-t border-dashed"></div>
          <span className="text-textMain">Shared Tags</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-0.5 bg-white/10"></div>
          <span className="text-textMuted">Semantic Similarity</span>
        </div>
      </div>
      <ForceGraph2D
        ref={graphRef}
        graphData={data}
        width={dimensions.width}
        height={dimensions.height}
        nodeLabel="name"
        nodeColor={(node: any) => node.val > 5 ? '#818cf8' : '#6366f1'} 
        linkColor={getLinkColor}
        linkWidth={getLinkWidth}
        onNodeClick={handleNodeClick}
        d3VelocityDecay={0.1}
        linkDirectionalParticles={link => (link as any).type === 'explicit' ? 2 : 0}
        linkDirectionalParticleSpeed={0.005}
        nodeCanvasObject={(node: any, ctx, globalScale) => {
          const label = node.name;
          const fontSize = 12 / globalScale;
          ctx.font = `${fontSize}px Sans-Serif`;
          const textWidth = ctx.measureText(label).width;
          const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2); 

          ctx.fillStyle = 'rgba(18, 18, 18, 0.8)';
          ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y - bckgDimensions[1] / 2, bckgDimensions[0], bckgDimensions[1]);

          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#ffffff';
          ctx.fillText(label, node.x, node.y);

          // Add a small ring around nodes with many chunks
          if (node.val > 3) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, (node.val * 0.5) + 5, 0, 2 * Math.PI);
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.2)';
            ctx.stroke();
          }

          node.__bckgDimensions = bckgDimensions;
        }}
        nodePointerAreaPaint={(node: any, color, ctx) => {
          ctx.fillStyle = color;
          const bckgDimensions = node.__bckgDimensions;
          bckgDimensions && ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y - bckgDimensions[1] / 2, bckgDimensions[0], bckgDimensions[1]);
        }}
      />
    </div>
  );
}
