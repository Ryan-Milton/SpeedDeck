import { describe, it, expect } from "vitest";
import { prettyTitle } from "./track-name";

describe("prettyTitle", () => {
  it("keeps a real title untouched", () => {
    expect(prettyTitle({ title: "Bohemian Rhapsody", path: "/x.mp3" })).toBe("Bohemian Rhapsody");
  });

  it("humanizes an underscore filename-style title", () => {
    expect(prettyTitle({ title: "MA_WarmMusic_Soulful_Static_Relax", path: "/x.mp3" })).toBe(
      "MA WarmMusic Soulful Static Relax"
    );
  });

  it("falls back to the file stem when title is missing", () => {
    expect(prettyTitle({ title: null, path: "/Music/cool_track_01.flac" })).toBe("Cool Track 01");
  });

  it("strips the extension and path", () => {
    expect(prettyTitle({ title: "", path: "C:\\songs\\my-song.wav" })).toBe("My-Song");
  });
});
