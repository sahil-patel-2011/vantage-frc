import { describe, expect, it } from "vitest";
import { countLodgingGaps, myRoomForUser, roomNeedsOccupant } from "./logistics";

describe("logistics lodging helpers", () => {
  it("treats empty occupant slots as lodging gaps", () => {
    expect(roomNeedsOccupant({ occupantUserId: null, occupantName: "" })).toBe(true);
    expect(roomNeedsOccupant({ occupantUserId: "u1", occupantName: "" })).toBe(false);
    expect(roomNeedsOccupant({ occupantUserId: null, occupantName: "Alex" })).toBe(false);
    expect(
      countLodgingGaps([
        { occupantUserId: null, occupantName: "" },
        { occupantUserId: null, occupantName: "Sam" },
        { occupantUserId: "u2", occupantName: "" },
      ]),
    ).toBe(1);
  });

  it("finds the signed-in user's room", () => {
    const rooms = [
      {
        id: "r1",
        hotelId: "h1",
        hotelName: "Inn",
        roomLabel: "101",
        occupantUserId: "u1",
        occupantName: "A",
        notes: "",
      },
      {
        id: "r2",
        hotelId: "h1",
        hotelName: "Inn",
        roomLabel: "102",
        occupantUserId: "u2",
        occupantName: "B",
        notes: "",
      },
    ];
    expect(myRoomForUser(rooms, "u2")?.roomLabel).toBe("102");
    expect(myRoomForUser(rooms, "missing")).toBeNull();
  });
});
