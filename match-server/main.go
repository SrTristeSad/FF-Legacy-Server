package main

import (
	"fmt"
	"log"
	"net"
	"os"
)

func main() {
	port := os.Getenv("GAME_SERVER_PORT")
	if port == "" {
		port = "10100"
	}

	addr, err := net.ResolveUDPAddr("udp", ":"+port)
	if err != nil {
		log.Fatal(err)
	}

	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		log.Fatal(err)
	}
	defer conn.Close()

	log.Printf("[match] listening on :%s/udp", port)
	buf := make([]byte, 64*1024)

	for {
		n, remote, err := conn.ReadFromUDP(buf)
		if err != nil {
			log.Printf("[match] read error: %v", err)
			continue
		}

		payload := buf[:n]
		if string(payload) == "PING" || string(payload) == "PING\n" {
			_, _ = conn.WriteToUDP([]byte("PONG\n"), remote)
			continue
		}

		fmt.Printf("[match] %s -> %d bytes\n", remote.String(), n)
	}
}
