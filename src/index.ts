import "log-timestamp";

import mqtt, { Client } from "mqtt";
import Api from "./api";
import EventProcessor from "./event_processor";
import { CameraDetails, CameraId, isMotionEndEvent } from "./types";

const { CAMERAS, DOWNLOAD_PATH, MQTT_HOST, UNIFI_HOST, UNIFI_USER, UNIFI_PASS } = process.env;

const cameraNames = CAMERAS?.split(",").map((camera) => camera.trim()) ?? [];

// const mqttCameraNames = cameraNames.map((camera) => camera.toLowerCase().replace(/\s/g, "_"));

if (!UNIFI_HOST || !UNIFI_USER || !UNIFI_PASS) {
  console.error("Unable to initialize; missing required configuration");
  process.exit(1);
}

const api = new Api({
  host: UNIFI_HOST,
  username: UNIFI_USER,
  password: UNIFI_PASS,
  downloadPath: DOWNLOAD_PATH ?? "/downloads",
});

const eventProcessor = new EventProcessor();
const initialize = async () => {
  try {
    await api.initialize();
  } catch (error) {
    console.error("Failed initializing API: %s", error);
    process.exit(1);
  }

  const allCameras = api.getCameras();
  const targetCameras = cameraNames.length
    ? allCameras.filter((camera) => cameraNames.includes(camera.name))
    : allCameras;
  const camerasById = new Map<CameraId, CameraDetails>(targetCameras.map((camera) => [camera.id, camera]));

  if (camerasById.size === 0) {
    console.error("Unable to find references to target cameras: %s, exiting", CAMERAS);
    process.exit(1);
  }

  console.info(
    "Setting up motion event subscription for cameras: %s",
    targetCameras.map((cam) => cam.name)
  );

  api.addSubscriber((message) => {
    const event = eventProcessor.parseMessage(message);
    if (event && isMotionEndEvent(event) && camerasById.has(event.camera)) {
      console.info("Processing event: %s", event);
      api.downloadVideo(event);
    }
  });

  const client: Client = mqtt.connect(MQTT_HOST, {
    will: {
      topic: "unifi/protect-downloader/availability",
      payload: "offline",
      qos: 1,
      retain: true,
    },
  });

  client.on("error", (error) => {
    console.error(`MQTT error: ${error.message}`);
  });

  client.on("connect", () => {
    console.info("Connected to MQTT broker");

    client.publish("unifi/protect-downloader/availability", "online", {
      qos: 1,
      retain: true,
    });

    //   if (mqttCameraNames.length > 0) {
    //     console.info(
    //       `Subcribing to motion events for cameras: ${mqttCameraNames.join(", ")}`
    //     );
    //     mqttCameraNames.map((cameraName) =>
    //       client.subscribe(`unifi/camera/motion/${cameraName}`)
    //     );
    //   } else {
    //     console.info("Subcribing to motion events for all cameras");
    //     client.subscribe("unifi/camera/motion/#");
    //   }
    // });

    // client.on("message", (topic: string, message: Buffer) => {
    //   if (topic.startsWith("unifi/camera/motion/")) {
    //     const motionEvent: MotionEvent = JSON.parse(message.toString());
    //     return videoDownloader.download(motionEvent);
    //   }

    //   console.warn("No handler for topic: %s", topic);
  });
};

initialize();
