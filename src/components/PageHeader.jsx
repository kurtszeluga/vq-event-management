import { Link } from 'react-router-dom';

// breadcrumb is an optional array of { label, to? }; the last entry (or any
// entry with no `to`) renders as plain text rather than a link, since it names
// the page already showing.
function PageHeader({ breadcrumb, description, eyebrow, title }) {
  return (
    <header className="page-header">
      {breadcrumb?.length ? (
        <nav aria-label="Breadcrumb" className="breadcrumb">
          {breadcrumb.map((crumb, index) => {
            const isLast = index === breadcrumb.length - 1;

            return (
              <span className="breadcrumb-item" key={crumb.label}>
                {crumb.to && !isLast ? (
                  <Link to={crumb.to}>{crumb.label}</Link>
                ) : (
                  <span className="breadcrumb-current">{crumb.label}</span>
                )}
                {isLast ? null : <span aria-hidden="true" className="breadcrumb-sep" />}
              </span>
            );
          })}
        </nav>
      ) : null}
      <p>{eyebrow}</p>
      <h1>{title}</h1>
      <span>{description}</span>
    </header>
  );
}

export default PageHeader;
