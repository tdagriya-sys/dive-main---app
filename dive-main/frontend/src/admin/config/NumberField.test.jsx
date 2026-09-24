import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import NumberField from "./NumberField";

describe("NumberField", () => {
  it("renders the label and current value", () => {
    render(<NumberField label="Crypto cap" value={70} onChange={() => {}} testId="crypto-cap" />);
    expect(screen.getByText("Crypto cap")).toBeInTheDocument();
    expect(screen.getByTestId("crypto-cap")).toHaveValue(70);
  });

  it("calls onChange with a number when edited", () => {
    const onChange = jest.fn();
    render(<NumberField label="Crypto cap" value={70} onChange={onChange} testId="crypto-cap" />);
    fireEvent.change(screen.getByTestId("crypto-cap"), { target: { value: "55" } });
    expect(onChange).toHaveBeenCalledWith(55);
  });

  it("calls onChange with an empty string while the field is cleared, not NaN", () => {
    const onChange = jest.fn();
    render(<NumberField label="Crypto cap" value={70} onChange={onChange} testId="crypto-cap" />);
    fireEvent.change(screen.getByTestId("crypto-cap"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("renders a suffix when given", () => {
    render(<NumberField value={5} onChange={() => {}} testId="target" suffix="classes" />);
    expect(screen.getByText("classes")).toBeInTheDocument();
  });
});
