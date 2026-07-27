import * as Location from 'expo-location';

export interface GpsTag {
  gpsLat: number | null;
  gpsLng: number | null;
  gpsAccuracyM: number | null;
  compassHeadingDeg: number | null;
}

const EMPTY_TAG: GpsTag = { gpsLat: null, gpsLng: null, gpsAccuracyM: null, compassHeadingDeg: null };

/**
 * Best-effort GPS tag for a capture. Never throws — a capture without GPS is far
 * better than a failed capture, so permission denial or a timeout just yields nulls.
 */
export async function getCurrentGpsTag(): Promise<GpsTag> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      const req = await Location.requestForegroundPermissionsAsync();
      if (req.status !== 'granted') return EMPTY_TAG;
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    let heading: number | null = null;
    try {
      const headingResult = await Location.getHeadingAsync();
      heading = Number.isFinite(headingResult.trueHeading) && headingResult.trueHeading >= 0
        ? headingResult.trueHeading
        : headingResult.magHeading ?? null;
    } catch {
      // Heading sensor unavailable on this device — GPS position is still useful alone.
    }

    return {
      gpsLat: position.coords.latitude,
      gpsLng: position.coords.longitude,
      gpsAccuracyM: position.coords.accuracy,
      compassHeadingDeg: heading,
    };
  } catch {
    return EMPTY_TAG;
  }
}
