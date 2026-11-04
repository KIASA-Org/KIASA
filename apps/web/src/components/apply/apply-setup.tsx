import { Download } from "../site/icons";

/** The newest KIASA Browser. Update these when a new build is released. */
export const BROWSER_VERSION = "1.2.0";
/** Where the KIASA Browser zip is published (a GitHub release, as the Live Script is). */
export const BROWSER_DOWNLOAD = "https://github.com/KIASA-Org/KIASA/releases/download/browser-1.2.0/KIASA-Browser.zip";

/** The Auto apply page: setting up the KIASA Browser on this PC. The agent that
 * applies for jobs, and its link to KIASA's model server, come after this. */
export function ApplySetup() {
  return <div className="jobs-card interview-setup">
    <p className="resume-folder-title">Set up the KIASA Browser</p>
    <p className="jobs-form-hint">The KIASA Browser is the browser on this PC that applies for jobs for you. Set it up once; you do not need to install any AI software, because KIASA provides that.</p>
    <ol className="resume-steps">
      <li><a className="jobs-button" data-primary="" href={BROWSER_DOWNLOAD}><Download /> Download the KIASA Browser</a></li>
      <li>Unzip it (right-click the file, <b>Extract All</b>).</li>
      <li>Open the program in the folder. If Windows says it protected your PC, press <b>More info</b>, then <b>Run anyway</b>.</li>
      <li>Press <b>Start the KIASA Browser</b> below. If Chrome asks to open it, choose <b>Open</b>. From now on, this button is all you need, and the browser keeps itself up to date.</li>
      <li>The browser opens on a page showing its IP address and location. Sign in to the job sites you use in it. Your sign-ins stay on this PC.</li>
    </ol>
    <p className="jobs-form-hint">Needs Windows 10 or 11 and Google Chrome. The first start downloads about 100 MB. If KIASA gave you a proxy, open <b>KIASA Settings</b> from the Start menu and enter it before you press Start. Applying for jobs itself is the next step and is not switched on yet.</p>
  </div>;
}
