import { describe, expect, test } from "vitest";
import { costLevelLabel, moneyValue, operationLabel, routeLabel, stringAmount } from "./coinbaseOperations";

describe("coinbaseOperations helpers", () => {
  test("extrae importes de números, strings y objetos Coinbase Money", () => {
    expect(moneyValue(10)).toBe(10);
    expect(moneyValue("12.5")).toBe(12.5);
    expect(moneyValue({ value: "3.21", currency: "EUR" })).toBe(3.21);
    expect(moneyValue("nope")).toBeNull();
  });

  test("convierte cantidades de preview a texto seguro", () => {
    expect(stringAmount({ value: "0.001" })).toBe("0.001");
    expect(stringAmount(5)).toBe("5");
    expect(stringAmount(null)).toBeNull();
  });

  test("etiqueta coste, operación y ruta", () => {
    expect(costLevelLabel("muy_alto")).toBe("Coste muy alto");
    expect(operationLabel("rebuy")).toBe("Recompra");
    expect(routeLabel("multi_step")).toBe("Ruta multipaso");
  });
});
