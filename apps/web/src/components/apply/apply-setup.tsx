import { Download } from "../site/icons";

/** Where the KIASA Browser zip is published (a GitHub release, as the Live Script is).
 * Update this when a new build is released. */
export const BROWSER_DOWNLOAD = "https://github.com/KIASA-Org/KIASA/releases/download/browser-1.1.1/KIASA-Browser.zip";

/** The Auto apply page: setting up the KIASA Browser on this PC. The agent that
 * applies for jobs, and its link to KIASA's model server, come after this. */
export function ApplySetup() {
  return <div className="jobs-card interview-setup">
    <p className="resume-folder-title">Set up the KIASA Browser</p>
    <p className="jobs-form-hint">The KIASA Browser is the browser on this PC that applies for jobs for you. Set it up once; you do not need to install any AI software, because KIASA provides that.</p>
    <ol className="resume-steps">
      <li><a className="jobs-button" data-primary="" href={BROWSER_DOWNLOAD}><Download /> Download the KIASA Browser</a></li>
      <li>Unzip it (right-click the file, <b>Extract All</b>).</li>
      <li>Open the program in the folder and follow its steps. If Windows says it protected your PC, press <b>More info</b>, then <b>Run anyway</b>.</li>
      <li>In the settings window that opens, press <b>Connect this PC</b> below, copy the code it shows, and paste it in <b>KIASA connection</b>. If KIASA gave you a proxy, enter it too, then press <b>Save</b>.</li>
      <li>The browser opens on this page. Sign in to the job sites you use in it. Your sign-ins stay on this PC.</li>
    </ol>
    <p className="jobs-form-hint">Needs Windows 10 or 11 and Google Chrome (the app uses its own copy if Chrome is missing). Once connected, the browser shows below with its live status, and KIASA admins can see it too. Applying for jobs itself is the next step and is not switched on yet.</p>
  </div>;
}
