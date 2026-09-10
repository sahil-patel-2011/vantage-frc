"use client";
import { Button } from "../../components/ui";

import { useEffect, useRef, useState } from "react";
import type { InventoryLocation } from "../../lib/inventory";
import { cameraScanSupported, openRearCamera, renderQrDataUrl, scanQrFromCamera } from "../../lib/scouting/qr-camera";

function locationUrl(orgId: string, locationId: string) {
  const origin = typeof window === "undefined" ? "https://vantage.local" : window.location.origin;
  const url = new URL("/inventory", origin);
  url.searchParams.set("orgId", orgId);
  url.searchParams.set("locationId", locationId);
  return url.toString();
}

export default function InventoryLabelTools({
  orgId,
  locations,
  onLocate,
  onClose,
}: {
  orgId: string;
  locations: InventoryLocation[];
  onLocate: (location: InventoryLocation) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [images, setImages] = useState<Record<string,string>>({});
  const [manual, setManual] = useState("");
  const [message, setMessage] = useState("");
  const [scanning, setScanning] = useState(false);

  useEffect(() => () => {
    abortRef.current?.abort();
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
  }, []);

  async function ensureLabels() {
    const next: Record<string,string> = {};
    for (const location of locations) next[location.id] = await renderQrDataUrl(locationUrl(orgId,location.id),220);
    setImages(next);
  }

  function resolve(value: string) {
    try {
      const url = new URL(value.trim(),window.location.origin);
      const locationId = url.searchParams.get("locationId");
      const location = locations.find((row) => row.id === locationId);
      if (!location) throw new Error("That label is not a location on this team.");
      setMessage(`Found ${location.name} · ${location.itemCount} item${location.itemCount===1?"":"s"}`);
      onLocate(location);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unrecognized inventory label");
    }
  }

  async function startScan() {
    if(!cameraScanSupported()||!videoRef.current||!canvasRef.current){setMessage("Camera unavailable—paste the label URL instead.");return;}
    const abort = new AbortController(); abortRef.current=abort; setScanning(true);
    try {
      const stream=await openRearCamera(); videoRef.current.srcObject=stream; await videoRef.current.play();
      const value=await scanQrFromCamera({video:videoRef.current,canvas:canvasRef.current,signal:abort.signal});
      stream.getTracks().forEach((track)=>track.stop()); videoRef.current.srcObject=null; setScanning(false); resolve(value);
    } catch(error) {
      if(!(error instanceof DOMException&&error.name==="AbortError")) setMessage(error instanceof Error?error.message:"Camera scan failed");
      setScanning(false);
    }
  }

  function stopScan(){abortRef.current?.abort();const stream=videoRef.current?.srcObject as MediaStream|null;stream?.getTracks().forEach((track)=>track.stop());if(videoRef.current)videoRef.current.srcObject=null;setScanning(false);}

  return <section className="app-card inventory-label-tools">
    <header><div><h2>Find a bin instantly</h2><p className="app-muted">Scan a Vantage bin label to show everything stored there, or print durable labels for the shop.</p></div><button type="button" className="inventory-link" onClick={onClose}>Close</button></header>
    <div className="inventory-scan-actions">
      {scanning?<Button variant="secondary" type="button" onClick={stopScan}>Stop camera</Button>:<Button variant="primary" type="button" onClick={()=>void startScan()}>Scan bin label</Button>}
      <Button variant="secondary" type="button" disabled={!locations.length} onClick={()=>void ensureLabels()}>Build printable labels</Button>
      {Object.keys(images).length?<Button variant="secondary" type="button" onClick={()=>window.print()}>Print labels</Button>:null}
    </div>
    <video ref={videoRef} className={scanning?"inventory-scan-video":"inventory-scan-video hidden"} muted playsInline />
    <canvas ref={canvasRef} hidden />
    <form className="inventory-add-row" onSubmit={(event)=>{event.preventDefault();resolve(manual)}}><input value={manual} onChange={(event)=>setManual(event.target.value)} placeholder="Paste inventory label URL"/><Button variant="secondary" type="submit" disabled={!manual.trim()}>Open label</Button></form>
    {message?<p className="telemetry-status" role="status">{message}</p>:null}
    {Object.keys(images).length?<div className="inventory-label-sheet">{locations.map((location)=><article key={location.id} className="inventory-print-label"><strong>{location.name}</strong><span>{location.kind} · {location.itemCount} items</span>{images[location.id]?<img src={images[location.id]} alt={`QR label for ${location.name}`} width={180} height={180}/>:null}<small>Scan in Vantage Inventory</small></article>)}</div>:null}
  </section>;
}
