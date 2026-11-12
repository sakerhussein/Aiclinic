import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BookPage, FindPage, JoinPage, ManagePage } from "./app";
import { ChatPage } from "./chat";
import "./book.css";

// book.limitsiz.si/<clinic>, /<clinic>/manage#<private link>, /<clinic>/find ("Find my booking"), /<clinic>/chat (the assistant)
// and /<clinic>/j#<token> ("Join the visit", online visits)
const m = location.pathname.match(/^\/([a-z0-9-]{1,60})(\/manage|\/find|\/chat|\/j)?\/?$/);
const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    {!m ? <main className="bk"><p className="bk-hint">Limitsiz Clinic</p></main>
      : m[2] === "/manage" ? <ManagePage slug={m[1]} /> : m[2] === "/find" ? <FindPage slug={m[1]} /> : m[2] === "/chat" ? <ChatPage slug={m[1]} /> : m[2] === "/j" ? <JoinPage slug={m[1]} /> : <BookPage slug={m[1]} />}
  </StrictMode>,
);
