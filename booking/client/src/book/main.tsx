import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BookPage, ManagePage } from "./app";
import "./book.css";

// book.limitsiz.si/<clinic> and book.limitsiz.si/<clinic>/manage#<private link>
const m = location.pathname.match(/^\/([a-z0-9-]{1,60})(\/manage)?\/?$/);
const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    {!m ? <main className="bk"><p className="bk-hint">Limitsiz Clinic</p></main> : m[2] ? <ManagePage slug={m[1]} /> : <BookPage slug={m[1]} />}
  </StrictMode>,
);
