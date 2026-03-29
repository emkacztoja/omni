import { useEffect, useState, useRef, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

interface GraphData {
  nodes: { id: string; name: string; val: number }[];
  links: { source: string; target: string; value: number }[];
}

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

  return (
    <div ref={containerRef} className="w-full h-full relative bg-surface/50 rounded-2xl overflow-hidden border border-border shadow-inner">
      {data.nodes.length < 2 && (
        <div className="absolute inset-0 flex items-center justify-center text-textMuted z-10 pointer-events-none">
          Add at least two notes to the Vault to visualize their structural affinities.
        </div>
      )}
      <ForceGraph2D
        ref={graphRef}
        graphData={data}
        width={dimensions.width}
        height={dimensions.height}
        nodeLabel="name"
        nodeColor={() => '#6366f1'} 
        linkColor={() => 'rgba(255, 255, 255, 0.15)'}
        nodeRelSize={6}
        linkWidth={link => (link as any).value * 4}
        onNodeClick={handleNodeClick}
        d3VelocityDecay={0.1}
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
