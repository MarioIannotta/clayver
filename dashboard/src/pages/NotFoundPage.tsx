import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="page">
      <h1>Page not found</h1>
      <p>
        <Link to="/conversations">Go to the inbox</Link>
      </p>
    </div>
  );
}
