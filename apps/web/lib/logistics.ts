/**
 * Lodging gap helpers shared by dashboard home strips.
 * Full logistics domain (trips/CRUD) may live alongside this file as it lands.
 */

export type LogisticsRoom = {
  id: string;
  hotelId: string;
  hotelName: string;
  roomLabel: string;
  occupantUserId: string | null;
  occupantName: string;
  notes: string;
};

/** Room has no linked member and no free-text occupant name. */
export function roomNeedsOccupant(room: Pick<LogisticsRoom, "occupantUserId" | "occupantName">): boolean {
  return !room.occupantUserId && !room.occupantName.trim();
}

export function countLodgingGaps(
  rooms: Array<Pick<LogisticsRoom, "occupantUserId" | "occupantName">>,
): number {
  return rooms.filter(roomNeedsOccupant).length;
}

export function myRoomForUser(rooms: LogisticsRoom[], userId: string): LogisticsRoom | null {
  return rooms.find((room) => room.occupantUserId === userId) ?? null;
}
