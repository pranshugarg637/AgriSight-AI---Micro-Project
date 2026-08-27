import "./SourcesList.css";

export default function SourcesList({ sources, retrievalStatus }) {
  if (retrievalStatus === "knowledge_base_empty") {
    return (
      <div className="sources sources--empty">
        <h3 className="sources__title">Sources</h3>
        <p>The agricultural knowledge base has no documents loaded yet. See docs/rag.md for setup.</p>
      </div>
    );
  }

  if (!sources || sources.length === 0) {
    return (
      <div className="sources sources--empty">
        <h3 className="sources__title">Sources</h3>
        <p>No sufficiently relevant sources were found for this diagnosis.</p>
      </div>
    );
  }

  return (
    <div className="sources">
      <h3 className="sources__title">Sources</h3>
      <ul className="sources__list">
        {sources.map((source, i) => (
          <li key={i} className="sources__card">
            <div className="sources__card-header">
              <span className="sources__doc-title">{source.title}</span>
              <span className="sources__relevance mono">{Math.round(source.relevance_score * 100)}% match</span>
            </div>
            <div className="sources__meta">
              <span>{source.organization}</span>
              {source.page != null && <span>· Page {source.page}</span>}
            </div>
            <p className="sources__excerpt">{source.excerpt}</p>
            {source.source_url && (
              <a href={source.source_url} target="_blank" rel="noopener noreferrer" className="sources__link">
                View source
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
