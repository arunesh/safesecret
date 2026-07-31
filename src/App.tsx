import { Link, Route, Routes } from "react-router";
import { Layout } from "./components/Layout.js";
import { CreatePage } from "./routes/CreatePage.js";
import { FaqPage } from "./routes/FaqPage.js";
import { RevealPage } from "./routes/RevealPage.js";

function NotFound() {
  return (
    <div className="card reveal-card">
      <h1>Nothing here</h1>
      <p className="lede">That page doesn&rsquo;t exist.</p>
      <Link to="/" className="button">
        Share a secret
      </Link>
    </div>
  );
}

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<CreatePage />} />
        <Route path="/s/:id" element={<RevealPage />} />
        <Route path="/faq" element={<FaqPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
