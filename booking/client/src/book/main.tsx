import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BookPage, FindPage, ManagePage } from "./app";
import "./book.css";

// book.limitsiz.si/<clinic>, /<clinic>/manage#<private link> and /<clinic>/find ("Find my booking")
const m = location.pathname.match(/^\/([a-z0-9-]{1,60})(\/manage|\/find)?\/?$/);
const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    {!m ? <main className="bk"><p className="bk-hint">Limitsiz Clinic</p></main>
      : m[2] === "/manage" ? <ManagePage slug={m[1]} /> : m[2] === "/find" ? <FindPage slug={m[1]} /> : <BookPage slug={m[1]} />}
  </StrictMode>,
);
