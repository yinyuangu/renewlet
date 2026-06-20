import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { telegramBotService } from "@/services/telegram-bot-service";

const TELEGRAM_BOT_COMMANDS_QUERY_KEY = ["telegram-bot-commands"] as const;

export function useTelegramBotCommands() {
  return useQuery({
    queryKey: TELEGRAM_BOT_COMMANDS_QUERY_KEY,
    queryFn: () => telegramBotService.getCommands(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useInstallTelegramBotCommands() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => telegramBotService.installCommands(),
    onSuccess: (response) => {
      queryClient.setQueryData(TELEGRAM_BOT_COMMANDS_QUERY_KEY, response);
    },
  });
}

export function useDeleteTelegramBotCommands() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => telegramBotService.deleteCommands(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TELEGRAM_BOT_COMMANDS_QUERY_KEY });
    },
  });
}
