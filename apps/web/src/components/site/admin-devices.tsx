"use client";

import { useState } from "react";
import { approveDevice, forgetDevice } from "@/lib/accounts/device-actions";
import type { AdminDevice } from "@/lib/accounts/devices";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const when = (iso: string | null) => {
  if (!iso) return "Not yet";
  const [year, month, date] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[month - 1]} ${date}, ${year}, ${iso.slice(11, 16)} UTC`;
};

/** The admin's devices: their account works on these alone. A sign-in anywhere
 * else, even with the password, is refused and asks here, to be approved or
 * refused; an approved device can be removed (it is signed out at once). */
export function AdminDevices({ on, devices, here }: { on: boolean; devices: AdminDevice[]; here: string | null }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ text: string; failed?: boolean } | null>(null);
  const asking = devices.filter(device => !device.approved_at);
  const approved = devices.filter(device => device.approved_at);

  const act = async (device: AdminDevice, what: "approve" | "refuse" | "remove") => {
    setBusy(device.id);
    setSaid(null);
    const { error } = what === "approve" ? await approveDevice(device.id) : await forgetDevice(device.id);
    setBusy(null);
    setSaid(error ? { text: error, failed: true }
      : what === "approve" ? { text: `${device.name} is approved. Sign in on it again to use it.` }
        : what === "refuse" ? { text: `${device.name} was refused.` } : { text: `${device.name} was removed and signed out.` });
  };

  return <section className="block admin-devices" id="admin-devices" aria-labelledby="admin-devices-title">
    <div className="wrap wrap-wide">
      <header className="block-head">
        <div className="block-head-text">
          <h2 id="admin-devices-title" className="block-title">Your devices</h2>
          <p className="block-lead">{on
            ? "Your admin account works only on these. A sign-in anywhere else, even with your password, is refused and asks here first."
            : "The device lock is off in this database, so your admin account works anywhere."}</p>
        </div>
      </header>
      <div role="status">{said && <p className="admin-notice" data-failed={said.failed ? "" : undefined}>{said.text}</p>}</div>
      {asking.length > 0 && <>
        <h3 className="admin-devices-sub">Asking to be added</h3>
        <ul className="admin-requests">
          {asking.map(device => <li key={device.id} className="admin-request admin-device" data-asking="">
            <div className="admin-request-who">
              <p className="admin-request-name">{device.name}</p>
              <p className="admin-request-email">Not you? Refuse it, and change your password: someone has it.</p>
            </div>
            <dl className="admin-request-facts">
              <div><dt>From</dt><dd>{device.address ?? "Unknown"}</dd></div>
              <div><dt>Asked</dt><dd>{when(device.asked_at)}</dd></div>
            </dl>
            <div className="admin-request-actions">
              <button type="button" className="admin-approve" disabled={busy === device.id} aria-label={`Approve ${device.name}`} onClick={() => void act(device, "approve")}>Approve</button>
              <button type="button" className="account-button" disabled={busy === device.id} aria-label={`Refuse ${device.name}`} onClick={() => void act(device, "refuse")}>Refuse</button>
            </div>
          </li>)}
        </ul>
      </>}
      <h3 className="admin-devices-sub">Approved</h3>
      {approved.length ? <ul className="admin-requests">
        {approved.map(device => <li key={device.id} className="admin-request admin-device">
          <div className="admin-request-who">
            <p className="admin-request-name">{device.name}{device.id === here && <span className="admin-device-here">This device</span>}</p>
            <p className="admin-request-email">Last from {device.address ?? "an unknown address"}</p>
          </div>
          <dl className="admin-request-facts">
            <div><dt>Approved</dt><dd>{when(device.approved_at)}</dd></div>
            <div><dt>Last sign-in</dt><dd>{when(device.last_used_at)}</dd></div>
          </dl>
          <div className="admin-request-actions">
            {device.id !== here && <button type="button" className="account-button" disabled={busy === device.id} aria-label={`Remove ${device.name}`} onClick={() => void act(device, "remove")}>Remove</button>}
          </div>
        </li>)}
      </ul> : <p className="b-jobs-empty">None yet: the next browser you sign in with becomes your first.</p>}
    </div>
  </section>;
}
