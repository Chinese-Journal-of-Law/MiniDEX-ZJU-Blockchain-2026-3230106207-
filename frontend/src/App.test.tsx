import { expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import App from "./App";

test("renders a presentation dashboard and keeps feature modules reachable", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: /MiniDEX 去中心化交易所/i })).toBeInTheDocument();
  expect(screen.getByText(/钱包未连接/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /LP NFT 仓位/i }));
  expect(screen.getByRole("heading", { name: /Pool 2 · NFT #6 赎回验收（只读）/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /赎回NFT #4（不可用）/i })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /代币兑换.*Swap/i }));
  expect(screen.getByRole("heading", { name: /Swap TKA → TKB/i })).toBeInTheDocument();
});
