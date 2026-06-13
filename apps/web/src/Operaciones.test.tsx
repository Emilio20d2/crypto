import { describe, test, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Operaciones } from './pages/Operaciones';

// Mock del IPC API
beforeEach(() => {
  (window as unknown as { api: unknown }).api = {
    transactions: {
      create: async () => ({ success: true })
    }
  };
});

describe("Operaciones UI", () => {
  test("rechazar cantidades negativas", async () => {
    render(<Operaciones />);
    
    // Rellenar fecha
    const dateInput = screen.getByLabelText(/Fecha/i);
    fireEvent.change(dateInput, { target: { value: "2026-06-13T10:00" } });
    
    const assetInput = screen.getByLabelText(/Activo/i);
    fireEvent.change(assetInput, { target: { value: "bitcoin" } });

    const amountInput = screen.getByLabelText(/Cantidad/i);
    fireEvent.change(amountInput, { target: { value: "-5" } });
    
    const submitBtn = screen.getByText(/Guardar Operación/i);
    fireEvent.click(submitBtn);

    // Debe mostrar error de cantidad
    await waitFor(() => {
      expect(screen.getByText(/La cantidad debe ser mayor a 0/i)).toBeInTheDocument();
    });
  });
});
