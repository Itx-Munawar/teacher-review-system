import React from 'react';

/** Suspense fallback while a lazily-loaded screen chunk downloads. */
const ChunkFallback: React.FC = () => <div className="loading" role="status">Loading…</div>;

export default ChunkFallback;
