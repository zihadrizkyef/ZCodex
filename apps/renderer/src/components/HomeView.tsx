import { CodexLogo } from "./CodexLogo";
import { Composer } from "./Composer";

export function HomeView(): React.ReactElement {
  return (
    <>
      <div className="scroll-area">
        <div className="empty">
          <div className="empty-logo">
            <CodexLogo size={48} />
          </div>
          <div className="empty-title">What should we build?</div>
        </div>
      </div>
      <Composer />
    </>
  );
}
