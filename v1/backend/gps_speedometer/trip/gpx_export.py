"""Export trip data as GPX 1.1 XML."""

from __future__ import annotations

import xml.etree.ElementTree as ET

from .database import TripDatabase


GPX_NS = "http://www.topografix.com/GPX/1/1"
XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"
GPX_SCHEMA = "http://www.topografix.com/GPX/1/1/gpx.xsd"


def export_trip_gpx(db: TripDatabase, trip_id: int) -> str:
    """Generate GPX 1.1 XML string for a trip."""
    trips = db.get_trips()
    trip = next((t for t in trips if t["id"] == trip_id), None)
    if not trip:
        raise ValueError(f"Trip {trip_id} not found")

    trackpoints = db.get_trackpoints(trip_id)

    gpx = ET.Element("gpx")
    gpx.set("xmlns", GPX_NS)
    gpx.set("xmlns:xsi", XSI_NS)
    gpx.set("xsi:schemaLocation", f"{GPX_NS} {GPX_SCHEMA}")
    gpx.set("version", "1.1")
    gpx.set("creator", "GPS Speedometer")

    # Metadata
    metadata = ET.SubElement(gpx, "metadata")
    name_el = ET.SubElement(metadata, "name")
    name_el.text = trip.get("name") or f"Trip {trip_id}"
    time_el = ET.SubElement(metadata, "time")
    time_el.text = trip["started_at"]

    # Track
    trk = ET.SubElement(gpx, "trk")
    trk_name = ET.SubElement(trk, "name")
    trk_name.text = trip.get("name") or f"Trip {trip_id}"

    trkseg = ET.SubElement(trk, "trkseg")

    for pt in trackpoints:
        trkpt = ET.SubElement(trkseg, "trkpt")
        trkpt.set("lat", f"{pt['latitude']:.7f}")
        trkpt.set("lon", f"{pt['longitude']:.7f}")

        if pt.get("altitude") is not None:
            ele = ET.SubElement(trkpt, "ele")
            ele.text = f"{pt['altitude']:.1f}"

        time_pt = ET.SubElement(trkpt, "time")
        time_pt.text = pt["timestamp"]

        if pt.get("speed") is not None:
            # Speed as extension (common convention)
            extensions = ET.SubElement(trkpt, "extensions")
            speed_el = ET.SubElement(extensions, "speed")
            speed_el.text = f"{pt['speed']:.2f}"

        if pt.get("heading") is not None:
            if trkpt.find("extensions") is None:
                extensions = ET.SubElement(trkpt, "extensions")
            else:
                extensions = trkpt.find("extensions")
            course_el = ET.SubElement(extensions, "course")
            course_el.text = f"{pt['heading']:.1f}"

    ET.indent(gpx, space="  ")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(
        gpx, encoding="unicode"
    )
