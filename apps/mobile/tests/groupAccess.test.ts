import { inviteCode } from "@/features/groups/groupAccess";

test("invitation input accepts own links or codes but not arbitrary URLs", () => {
  expect(inviteCode(" abcd1234 ")).toBe("ABCD1234");
  expect(inviteCode("https://dinner.dcss.dev/join?code=abcd1234")).toBe("ABCD1234");
  expect(inviteCode("dinnerswipe://join?code=ABCD1234")).toBe("ABCD1234");
  expect(inviteCode("https://unrelated.example/join?code=ABCD1234")).toBe("");
  expect(inviteCode("javascript:alert(1)")).toBe("");
  expect(inviteCode("abcd")).toBe("");
});
