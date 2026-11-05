/* v1.70 — components read flash() / confirm() / prompt() from the toast context; a test that wants to observe the
   toast or answer a confirmation wraps the component in <ToastStub flash={vi.fn()} confirm={true}>. */
import { ToastContextForTests } from "../../src/toast-context.jsx";

export const ToastStub = ({ flash = () => {}, confirm = true, prompt = "", children }) => (
  <ToastContextForTests.Provider value={{ flash, confirm: async () => confirm, prompt: async () => prompt }}>{children}</ToastContextForTests.Provider>
);
